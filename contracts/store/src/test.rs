#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, IssuerFlags, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env, IntoVal, Symbol,
};

/// 1 USDC in its smallest unit (7 decimals).
const USDC: i128 = 10_000_000;

struct Setup {
    env: Env,
    store: StoreClient<'static>,
    usdc: TokenClient<'static>,
    usdc_admin: StellarAssetClient<'static>,
    admin: Address,
    fee_to: Address,
}

fn setup(fee_bps: u32) -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    // Lets a test freeze a wallet, the way an issuer can on mainnet.
    sac.issuer().set_flag(IssuerFlags::RevocableFlag);
    let usdc = TokenClient::new(&env, &sac.address());
    let usdc_admin = StellarAssetClient::new(&env, &sac.address());

    let admin = Address::generate(&env);
    let fee_to = Address::generate(&env);
    let store_id = env.register(
        Store,
        (admin.clone(), sac.address(), fee_bps, fee_to.clone()),
    );
    let store = StoreClient::new(&env, &store_id);
    Setup {
        env,
        store,
        usdc,
        usdc_admin,
        admin,
        fee_to,
    }
}

impl Setup {
    fn wallet(&self, usdc: i128) -> Address {
        let a = Address::generate(&self.env);
        if usdc > 0 {
            self.usdc_admin.mint(&a, &usdc);
        }
        a
    }

    fn share(&self, to: &Address, bps: u32) -> Share {
        Share {
            to: to.clone(),
            bps,
        }
    }

    fn no_shares(&self) -> Vec<Share> {
        Vec::new(&self.env)
    }
}

#[test]
fn a_sale_pays_everyone_in_one_transaction() {
    let s = setup(500); // 5% platform fee
    let creator = s.wallet(0);
    let co = s.wallet(0);
    let affiliate = s.wallet(0);
    let buyer = s.wallet(10 * USDC);

    // 10 USDC; co-creator 20%, affiliate 10%
    let id = s.store.create_product(
        &creator,
        &(10 * USDC),
        &vec![&s.env, s.share(&co, 2_000)],
        &1_000,
    );
    let receipt = s.store.buy(&buyer, &id, &Some(affiliate.clone()));

    assert_eq!(s.usdc.balance(&s.fee_to), USDC / 2);
    assert_eq!(s.usdc.balance(&co), 2 * USDC);
    assert_eq!(s.usdc.balance(&affiliate), USDC);
    assert_eq!(s.usdc.balance(&creator), 65 * USDC / 10);
    assert_eq!(s.usdc.balance(&buyer), 0);
    assert_eq!(s.usdc.balance(&s.store.address), 0);

    assert_eq!(receipt.product_id, id);
    assert_eq!(receipt.buyer, buyer);
    assert_eq!(receipt.price, 10 * USDC);
    assert_eq!(receipt.affiliate, Some(affiliate));
    assert_eq!(receipt.timestamp, 1_700_000_000);
    assert_eq!(receipt.sale_number, 1);
    assert_eq!(s.store.product(&id).sales, 1);
}

#[test]
fn without_an_affiliate_the_creator_keeps_that_share() {
    let s = setup(500);
    let creator = s.wallet(0);
    let buyer = s.wallet(10 * USDC);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &1_000);

    let receipt = s.store.buy(&buyer, &id, &None);

    assert_eq!(receipt.affiliate, None);
    assert_eq!(s.usdc.balance(&s.fee_to), USDC / 2);
    assert_eq!(s.usdc.balance(&creator), 95 * USDC / 10);
}

#[test]
fn buyers_and_creators_cannot_refer_themselves() {
    let s = setup(0);
    let creator = s.wallet(0);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &3_000);

    let buyer = s.wallet(10 * USDC);
    let receipt = s.store.buy(&buyer, &id, &Some(buyer.clone()));
    assert_eq!(receipt.affiliate, None);
    assert_eq!(s.usdc.balance(&buyer), 0);

    let buyer2 = s.wallet(10 * USDC);
    let receipt = s.store.buy(&buyer2, &id, &Some(creator.clone()));
    assert_eq!(receipt.affiliate, None);

    assert_eq!(s.usdc.balance(&creator), 20 * USDC);
}

#[test]
fn affiliate_is_ignored_when_the_product_pays_none() {
    let s = setup(0);
    let creator = s.wallet(0);
    let referrer = s.wallet(0);
    let buyer = s.wallet(5 * USDC);
    let id = s
        .store
        .create_product(&creator, &(5 * USDC), &s.no_shares(), &0);

    let receipt = s.store.buy(&buyer, &id, &Some(referrer.clone()));

    assert_eq!(receipt.affiliate, None);
    assert_eq!(s.usdc.balance(&referrer), 0);
    assert_eq!(s.usdc.balance(&creator), 5 * USDC);
}

#[test]
fn splits_always_add_up_to_the_price() {
    let s = setup(333);
    let creator = s.wallet(0);
    let co1 = s.wallet(0);
    let co2 = s.wallet(0);
    let affiliate = s.wallet(0);
    let buyer = s.wallet(1_000_000 * USDC);
    let shares = vec![&s.env, s.share(&co1, 1_234), s.share(&co2, 777)];

    let mut prices: std::vec::Vec<i128> = (1..=120).collect();
    prices.extend([
        9_999,
        10_001,
        3 * USDC + 1,
        USDC - 1,
        123_456_789,
        25 * USDC,
        999_999 * USDC / 100,
    ]);

    let mut total = 0;
    for price in prices {
        let id = s.store.create_product(&creator, &price, &shares, &999);
        s.store.buy(&buyer, &id, &Some(affiliate.clone()));
        total += price;

        let fee = price * 333 / 10_000;
        let c1 = price * 1_234 / 10_000;
        let c2 = price * 777 / 10_000;
        let aff = price * 999 / 10_000;
        assert!(fee + c1 + c2 + aff <= price);
    }

    let paid = s.usdc.balance(&s.fee_to)
        + s.usdc.balance(&co1)
        + s.usdc.balance(&co2)
        + s.usdc.balance(&affiliate)
        + s.usdc.balance(&creator);
    assert_eq!(paid, total);
    assert_eq!(s.usdc.balance(&buyer), 1_000_000 * USDC - total);
    assert_eq!(s.usdc.balance(&s.store.address), 0);
}

#[test]
fn a_buyer_cannot_pay_twice_for_the_same_product() {
    let s = setup(500);
    let creator = s.wallet(0);
    let buyer = s.wallet(20 * USDC);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    s.store.buy(&buyer, &id, &None);
    assert_eq!(
        s.store.try_buy(&buyer, &id, &None),
        Err(Ok(Error::AlreadyPurchased))
    );
    assert_eq!(s.usdc.balance(&buyer), 10 * USDC);
}

#[test]
fn the_receipt_belongs_to_the_buyer_only() {
    let s = setup(0);
    let creator = s.wallet(0);
    let buyer = s.wallet(USDC);
    let stranger = s.wallet(0);
    let id = s.store.create_product(&creator, &USDC, &s.no_shares(), &0);

    assert!(!s.store.has_purchased(&id, &buyer));
    s.store.buy(&buyer, &id, &None);

    assert!(s.store.has_purchased(&id, &buyer));
    assert!(!s.store.has_purchased(&id, &stranger));
    assert_eq!(s.store.receipt(&id, &stranger), None);
    assert_eq!(s.store.receipt(&id, &buyer).unwrap().price, USDC);
}

#[test]
fn a_paused_product_cannot_be_bought() {
    let s = setup(0);
    let creator = s.wallet(0);
    let buyer = s.wallet(10 * USDC);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    s.store.update_product(&id, &(10 * USDC), &false);
    assert_eq!(
        s.store.try_buy(&buyer, &id, &None),
        Err(Ok(Error::ProductInactive))
    );

    s.store.update_product(&id, &(4 * USDC), &true);
    s.store.buy(&buyer, &id, &None);
    assert_eq!(s.usdc.balance(&buyer), 6 * USDC);
}

#[test]
fn unknown_products_are_reported() {
    let s = setup(0);
    let buyer = s.wallet(USDC);
    assert_eq!(
        s.store.try_buy(&buyer, &42, &None),
        Err(Ok(Error::ProductNotFound))
    );
    assert_eq!(s.store.try_product(&42), Err(Ok(Error::ProductNotFound)));
}

#[test]
fn listing_rejects_bad_splits() {
    let s = setup(500);
    let creator = s.wallet(0);
    let a = s.wallet(0);
    let b = s.wallet(0);
    let none = s.no_shares();
    let price = 10 * USDC;

    let create = |price: i128, shares: &Vec<Share>, aff: u32| {
        s.store.try_create_product(&creator, &price, shares, &aff)
    };

    assert_eq!(create(0, &none, 0), Err(Ok(Error::InvalidPrice)));
    assert_eq!(create(-5, &none, 0), Err(Ok(Error::InvalidPrice)));

    let six = (0..6).fold(Vec::new(&s.env), |mut v, _| {
        v.push_back(s.share(&s.wallet(0), 100));
        v
    });
    assert_eq!(create(price, &six, 0), Err(Ok(Error::TooManyShares)));

    let zero = vec![&s.env, s.share(&a, 0)];
    assert_eq!(create(price, &zero, 0), Err(Ok(Error::InvalidShare)));

    let to_creator = vec![&s.env, s.share(&creator, 1_000)];
    assert_eq!(create(price, &to_creator, 0), Err(Ok(Error::InvalidShare)));

    let twice = vec![&s.env, s.share(&a, 1_000), s.share(&a, 1_000)];
    assert_eq!(create(price, &twice, 0), Err(Ok(Error::InvalidShare)));

    // 5% fee + 60% + 30% + 10% affiliate = 105%
    let too_much = vec![&s.env, s.share(&a, 6_000), s.share(&b, 3_000)];
    assert_eq!(
        create(price, &too_much, 1_000),
        Err(Ok(Error::SharesTooHigh))
    );
    assert_eq!(create(price, &none, 9_501), Err(Ok(Error::SharesTooHigh)));
    assert_eq!(
        create(price, &none, u32::MAX),
        Err(Ok(Error::SharesTooHigh))
    );

    // exactly 100% is allowed: the creator simply keeps nothing
    let all = vec![&s.env, s.share(&a, 6_000), s.share(&b, 3_000)];
    assert!(create(price, &all, 500).is_ok());
    assert_eq!(s.store.product_count(), 1);
}

#[test]
fn the_fee_is_locked_when_a_product_is_listed() {
    let s = setup(500);
    let creator = s.wallet(0);
    let old = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    s.store.set_fee(&800, &s.fee_to);
    let new = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);
    assert_eq!(s.store.product(&old).fee_bps, 500);
    assert_eq!(s.store.product(&new).fee_bps, 800);

    s.store.buy(&s.wallet(10 * USDC), &old, &None);
    assert_eq!(s.usdc.balance(&s.fee_to), USDC / 2);
    s.store.buy(&s.wallet(10 * USDC), &new, &None);
    assert_eq!(s.usdc.balance(&s.fee_to), USDC / 2 + 8 * USDC / 10);
}

#[test]
fn the_fee_cannot_go_above_ten_percent() {
    let s = setup(1_000);
    assert_eq!(
        s.store.try_set_fee(&1_001, &s.fee_to),
        Err(Ok(Error::FeeTooHigh))
    );
    assert_eq!(s.store.config().fee_bps, 1_000);
}

#[test]
#[should_panic]
fn the_store_cannot_start_with_a_fee_above_ten_percent() {
    setup(1_001);
}

#[test]
fn a_share_that_cannot_be_delivered_is_held_and_does_not_block_the_sale() {
    let s = setup(0);
    let creator = s.wallet(0);
    let co = s.wallet(0);
    let buyer = s.wallet(10 * USDC);
    let id = s.store.create_product(
        &creator,
        &(10 * USDC),
        &vec![&s.env, s.share(&co, 3_000)],
        &0,
    );

    // The co-creator's wallet cannot receive USDC right now.
    s.usdc_admin.set_authorized(&co, &false);
    s.store.buy(&buyer, &id, &None);

    assert_eq!(s.usdc.balance(&creator), 7 * USDC);
    assert_eq!(s.usdc.balance(&co), 0);
    assert_eq!(s.store.owed(&co), 3 * USDC);
    assert_eq!(s.usdc.balance(&s.store.address), 3 * USDC);

    // Still blocked: claiming fails and nothing changes.
    assert!(s.store.try_claim(&co).is_err());
    assert_eq!(s.store.owed(&co), 3 * USDC);

    s.usdc_admin.set_authorized(&co, &true);
    assert_eq!(s.store.claim(&co), 3 * USDC);
    assert_eq!(s.usdc.balance(&co), 3 * USDC);
    assert_eq!(s.store.owed(&co), 0);
    assert_eq!(s.usdc.balance(&s.store.address), 0);
    assert_eq!(s.store.try_claim(&co), Err(Ok(Error::NothingOwed)));
}

#[test]
fn a_buyer_without_enough_usdc_gets_nothing_recorded() {
    let s = setup(500);
    let creator = s.wallet(0);
    let buyer = s.wallet(USDC);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    assert!(s.store.try_buy(&buyer, &id, &None).is_err());
    assert!(!s.store.has_purchased(&id, &buyer));
    assert_eq!(s.store.product(&id).sales, 0);
    assert_eq!(s.usdc.balance(&buyer), USDC);
    assert_eq!(s.usdc.balance(&creator), 0);
}

#[test]
fn buying_needs_the_buyers_signature_for_the_exact_price() {
    let s = setup(500);
    let creator = s.wallet(0);
    let buyer = s.wallet(10 * USDC);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    s.store.buy(&buyer, &id, &None);

    assert_eq!(
        s.env.auths(),
        std::vec![(
            buyer.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.store.address.clone(),
                    Symbol::new(&s.env, "buy"),
                    (buyer.clone(), id, None::<Address>).into_val(&s.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.usdc.address.clone(),
                        Symbol::new(&s.env, "transfer"),
                        (buyer.clone(), s.store.address.clone(), 10 * USDC).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn only_the_creator_can_change_a_product() {
    let s = setup(0);
    let creator = s.wallet(0);
    let id = s
        .store
        .create_product(&creator, &(10 * USDC), &s.no_shares(), &0);

    s.store.update_product(&id, &(2 * USDC), &true);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, creator);
    assert_eq!(s.store.product(&id).price, 2 * USDC);
}

#[test]
fn only_the_admin_can_change_the_fee() {
    let s = setup(0);
    s.store.set_fee(&250, &s.fee_to);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
}

#[test]
fn product_ids_count_up_from_one() {
    let s = setup(0);
    let creator = s.wallet(0);
    assert_eq!(s.store.product_count(), 0);
    let a = s.store.create_product(&creator, &USDC, &s.no_shares(), &0);
    let b = s.store.create_product(&creator, &USDC, &s.no_shares(), &0);
    assert_eq!((a, b), (1, 2));
    assert_eq!(s.store.product_count(), 2);
}
