//! Creator store: lists digital products and splits every sale.
//!
//! A buyer pays the full price in USDC in one transfer. In the same
//! transaction the contract pays the platform fee, each co-creator, the
//! affiliate (if any) and the creator, and records a receipt that unlocks
//! the download. The contract keeps nothing, except a share it could not
//! deliver because the recipient's wallet cannot receive USDC yet; that
//! share waits in the contract until someone calls `claim` for them.
//!
//! The platform fee is locked into each product when it is listed, so a
//! later fee change never touches products already on sale.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, ContractExecutable, Env, Vec,
};

/// Basis points in 100%.
const BPS: u32 = 10_000;
/// The platform fee can never be set above 10%.
pub const MAX_FEE_BPS: u32 = 1_000;
/// Co-creators per product.
pub const MAX_SHARES: u32 = 5;

const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;
const ENTRY_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const ENTRY_THRESHOLD: u32 = ENTRY_BUMP - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Fee above `MAX_FEE_BPS`.
    FeeTooHigh = 1,
    /// Price is zero or negative.
    InvalidPrice = 2,
    /// More than `MAX_SHARES` co-creators.
    TooManyShares = 3,
    /// A share of zero, a share to the creator, or the same co-creator twice.
    InvalidShare = 4,
    /// Fee, co-creator shares and affiliate share add up to more than 100%.
    SharesTooHigh = 5,
    ProductNotFound = 6,
    ProductInactive = 7,
    /// This buyer already owns this product.
    AlreadyPurchased = 8,
    /// `claim` called for an address the contract owes nothing.
    NothingOwed = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// The payment token (USDC's Stellar Asset Contract).
    pub token: Address,
    /// Platform fee for new listings, in basis points.
    pub fee_bps: u32,
    pub fee_to: Address,
}

/// A co-creator's cut of every sale, in basis points of the price.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Share {
    pub to: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Product {
    pub creator: Address,
    /// Price in the token's smallest unit (USDC has 7 decimals).
    pub price: i128,
    /// Platform fee locked at listing.
    pub fee_bps: u32,
    pub shares: Vec<Share>,
    /// Paid to whoever referred the buyer; goes to the creator when nobody did.
    pub affiliate_bps: u32,
    pub active: bool,
    pub sales: u32,
}

/// Proof of purchase. The app checks it before serving the download.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub product_id: u64,
    pub buyer: Address,
    pub price: i128,
    pub affiliate: Option<Address>,
    pub timestamp: u64,
    /// This was the product's nth sale.
    pub sale_number: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Config,
    NextId,
    Product(u64),
    Receipt(u64, Address),
    Owed(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listed {
    #[topic]
    pub product_id: u64,
    #[topic]
    pub creator: Address,
    pub price: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Sale {
    #[topic]
    pub product_id: u64,
    #[topic]
    pub buyer: Address,
    pub price: i128,
    pub affiliate: Option<Address>,
}

/// A share the contract could not deliver and now holds for `to`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Held {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claimed {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contract]
pub struct Store;

#[contractimpl]
impl Store {
    pub fn __constructor(env: Env, admin: Address, token: Address, fee_bps: u32, fee_to: Address) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::FeeTooHigh);
        }
        let storage = env.storage().instance();
        storage.set(
            &DataKey::Config,
            &Config {
                admin,
                token,
                fee_bps,
                fee_to,
            },
        );
        storage.set(&DataKey::NextId, &1u64);
    }

    // ---- creators ----

    /// Lists a product and returns its id. The current platform fee is
    /// locked into the product.
    pub fn create_product(
        env: Env,
        creator: Address,
        price: i128,
        shares: Vec<Share>,
        affiliate_bps: u32,
    ) -> Result<u64, Error> {
        creator.require_auth();
        let config = read_config(&env);
        check_listing(&creator, price, &shares, affiliate_bps, config.fee_bps)?;

        let storage = env.storage().instance();
        let id: u64 = storage.get(&DataKey::NextId).unwrap_or(1);
        storage.set(&DataKey::NextId, &(id + 1));
        bump_instance(&env);

        let product = Product {
            creator: creator.clone(),
            price,
            fee_bps: config.fee_bps,
            shares,
            affiliate_bps,
            active: true,
            sales: 0,
        };
        write_product(&env, id, &product);
        Listed {
            product_id: id,
            creator,
            price,
        }
        .publish(&env);
        Ok(id)
    }

    /// Changes the price or pauses/resumes sales. Shares cannot be changed
    /// after listing, so a creator cannot cut a co-creator out.
    pub fn update_product(
        env: Env,
        product_id: u64,
        price: i128,
        active: bool,
    ) -> Result<(), Error> {
        let mut product = read_product(&env, product_id)?;
        product.creator.require_auth();
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        product.price = price;
        product.active = active;
        write_product(&env, product_id, &product);
        bump_instance(&env);
        Ok(())
    }

    // ---- buyers ----

    /// Pays for a product and splits the payment. `affiliate` is ignored
    /// when the product pays no affiliate share, or when it names the buyer
    /// or the creator; that share then goes to the creator.
    pub fn buy(
        env: Env,
        buyer: Address,
        product_id: u64,
        affiliate: Option<Address>,
    ) -> Result<Receipt, Error> {
        buyer.require_auth();
        let mut product = read_product(&env, product_id)?;
        if !product.active {
            return Err(Error::ProductInactive);
        }
        let receipt_key = DataKey::Receipt(product_id, buyer.clone());
        if env.storage().persistent().has(&receipt_key) {
            return Err(Error::AlreadyPurchased);
        }

        let config = read_config(&env);
        let token = token::Client::new(&env, &config.token);
        let price = product.price;
        token.transfer(&buyer, env.current_contract_address(), &price);

        let affiliate =
            affiliate.filter(|a| product.affiliate_bps > 0 && *a != buyer && *a != product.creator);

        let mut left = price;
        let fee = cut(price, product.fee_bps);
        pay_out(&env, &token, &config.fee_to, fee);
        left -= fee;
        for share in product.shares.iter() {
            let amount = cut(price, share.bps);
            pay_out(&env, &token, &share.to, amount);
            left -= amount;
        }
        if let Some(a) = &affiliate {
            let amount = cut(price, product.affiliate_bps);
            pay_out(&env, &token, a, amount);
            left -= amount;
        }
        // The creator gets the remainder, so rounding never loses a unit.
        pay_out(&env, &token, &product.creator, left);

        product.sales += 1;
        write_product(&env, product_id, &product);

        let receipt = Receipt {
            product_id,
            buyer: buyer.clone(),
            price,
            affiliate: affiliate.clone(),
            timestamp: env.ledger().timestamp(),
            sale_number: product.sales,
        };
        let persistent = env.storage().persistent();
        persistent.set(&receipt_key, &receipt);
        persistent.extend_ttl(&receipt_key, ENTRY_THRESHOLD, ENTRY_BUMP);
        bump_instance(&env);

        Sale {
            product_id,
            buyer,
            price,
            affiliate,
        }
        .publish(&env);
        Ok(receipt)
    }

    /// Pays out everything held for `to`. Anyone may call it; the money
    /// only ever goes to `to`.
    pub fn claim(env: Env, to: Address) -> Result<i128, Error> {
        let key = DataKey::Owed(to.clone());
        let persistent = env.storage().persistent();
        let amount: i128 = persistent.get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingOwed);
        }
        persistent.remove(&key);
        let token = token::Client::new(&env, &read_config(&env).token);
        token.transfer(&env.current_contract_address(), &to, &amount);
        Claimed { to, amount }.publish(&env);
        Ok(amount)
    }

    // ---- reads ----

    pub fn product(env: Env, product_id: u64) -> Result<Product, Error> {
        read_product(&env, product_id)
    }

    pub fn product_count(env: Env) -> u64 {
        let next: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        next - 1
    }

    pub fn receipt(env: Env, product_id: u64, buyer: Address) -> Option<Receipt> {
        env.storage()
            .persistent()
            .get(&DataKey::Receipt(product_id, buyer))
    }

    pub fn has_purchased(env: Env, product_id: u64, buyer: Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Receipt(product_id, buyer))
    }

    pub fn owed(env: Env, to: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Owed(to))
            .unwrap_or(0)
    }

    pub fn config(env: Env) -> Config {
        read_config(&env)
    }

    // ---- admin ----

    /// Sets the fee for future listings. Products already listed keep theirs.
    pub fn set_fee(env: Env, fee_bps: u32, fee_to: Address) -> Result<(), Error> {
        let mut config = read_config(&env);
        config.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        config.fee_bps = fee_bps;
        config.fee_to = fee_to;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
        Ok(())
    }

    /// Hands admin to `new_admin`; both must sign.
    pub fn set_admin(env: Env, new_admin: Address) {
        let mut config = read_config(&env);
        config.admin.require_auth();
        new_admin.require_auth();
        config.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &config);
        bump_instance(&env);
    }

    pub fn upgrade(env: Env, wasm_hash: BytesN<32>) {
        read_config(&env).admin.require_auth();
        env.deployer()
            .update_current_contract(ContractExecutable::Wasm(wasm_hash));
    }
}

/// `bps` basis points of `price`, rounded down.
fn cut(price: i128, bps: u32) -> i128 {
    price * bps as i128 / BPS as i128
}

/// Sends `amount` from the contract to `to`. If `to` cannot receive it
/// (for example a wallet without a USDC trustline), the contract holds it
/// for them instead of failing the sale.
fn pay_out(env: &Env, token: &token::Client, to: &Address, amount: i128) {
    if amount <= 0 {
        return;
    }
    let sent = matches!(
        token.try_transfer(&env.current_contract_address(), to, &amount),
        Ok(Ok(()))
    );
    if sent {
        return;
    }
    let key = DataKey::Owed(to.clone());
    let persistent = env.storage().persistent();
    let held: i128 = persistent.get(&key).unwrap_or(0);
    persistent.set(&key, &(held + amount));
    persistent.extend_ttl(&key, ENTRY_THRESHOLD, ENTRY_BUMP);
    Held {
        to: to.clone(),
        amount,
    }
    .publish(env);
}

fn check_listing(
    creator: &Address,
    price: i128,
    shares: &Vec<Share>,
    affiliate_bps: u32,
    fee_bps: u32,
) -> Result<(), Error> {
    if price <= 0 {
        return Err(Error::InvalidPrice);
    }
    if shares.len() > MAX_SHARES {
        return Err(Error::TooManyShares);
    }
    if affiliate_bps > BPS {
        return Err(Error::SharesTooHigh);
    }
    let mut total = fee_bps + affiliate_bps;
    for (i, share) in shares.iter().enumerate() {
        if share.bps == 0 || share.to == *creator {
            return Err(Error::InvalidShare);
        }
        if share.bps > BPS {
            return Err(Error::SharesTooHigh);
        }
        for earlier in shares.iter().take(i) {
            if earlier.to == share.to {
                return Err(Error::InvalidShare);
            }
        }
        total += share.bps;
    }
    if total > BPS {
        return Err(Error::SharesTooHigh);
    }
    Ok(())
}

fn read_config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

fn read_product(env: &Env, id: u64) -> Result<Product, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Product(id))
        .ok_or(Error::ProductNotFound)
}

fn write_product(env: &Env, id: u64, product: &Product) {
    let key = DataKey::Product(id);
    let persistent = env.storage().persistent();
    persistent.set(&key, product);
    persistent.extend_ttl(&key, ENTRY_THRESHOLD, ENTRY_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

mod test;
