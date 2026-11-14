import { useEffect } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { Library } from "./pages/Library";
import { ProductPage } from "./pages/Product";
import { Sell } from "./pages/Sell";
import { Shop } from "./pages/Shop";
import { EXPLORER, STORE_ID } from "./config";
import { Logo } from "./ui";
import { short, useWallet, WalletProvider } from "./useWallet";

function Header() {
  const { wallet, stellar, restoring, signIn } = useWallet();
  const shown = wallet ?? stellar;
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand">
          <Logo />
          Paperstall
        </Link>
        <nav>
          <Link href="/#shelf" className="secondary">
            Shop
          </Link>
          <Link href="/sell">Sell</Link>
          <Link href="/library">Library</Link>
          <Link href="/dashboard" className="secondary">
            Dashboard
          </Link>
          {restoring ? null : shown ? (
            <Link href={wallet ? "/dashboard" : "/library"} className="chip" title={shown} data-testid="wallet">
              <span className="dot" />
              {short(shown)}
            </Link>
          ) : (
            <button className="chip" onClick={() => signIn().catch(() => {})} data-testid="sign-in">
              Sign in
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [location]);
  return null;
}

export function App() {
  return (
    <WalletProvider>
      <ScrollToTop />
      <Header />
      <main>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/sell" component={Sell} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/library" component={Library} />
          <Route path="/p/:id">{(params) => <ProductPage id={params.id} />}</Route>
          <Route path="/c/:id">{(params) => <Shop id={params.id} />}</Route>
          <Route>
            <section className="band dark">
              <div className="container">
                <h1>Nothing on this shelf.</h1>
                <Link href="/" className="text-link">
                  Back to the store
                </Link>
              </div>
            </section>
          </Route>
        </Switch>
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>Payments settle in USDC on Stellar testnet. A smart contract splits every sale the moment it happens.</span>
          <span className="footer-links">
            <a href={`${EXPLORER}/contract/${STORE_ID}`} target="_blank" rel="noreferrer">
              The contract
            </a>
            <a href="https://github.com/big14way/stellar-creator-store" target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </span>
        </div>
        <div className="wordmark-giant" aria-hidden="true">
          Paperstall
        </div>
      </footer>
    </WalletProvider>
  );
}
