import { useEffect } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { ProductPage } from "./pages/Product";
import { Sell } from "./pages/Sell";
import { Logo } from "./ui";
import { short, useWallet, WalletProvider } from "./useWallet";

function Header() {
  const { wallet, restoring, signIn } = useWallet();
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand">
          <Logo />
          Creator Store
        </Link>
        <nav>
          <Link href="/#shelf" className="secondary">
            Shop
          </Link>
          <Link href="/sell">Sell</Link>
          <Link href="/dashboard" className="secondary">
            Dashboard
          </Link>
          {restoring ? null : wallet ? (
            <Link href="/dashboard" className="chip" title={wallet} data-testid="wallet">
              <span className="dot" />
              {short(wallet)}
            </Link>
          ) : (
            <button className="chip" onClick={() => signIn().catch(() => {})}>
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
          <Route path="/p/:id">{(params) => <ProductPage id={params.id} />}</Route>
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
          <a href="https://github.com/big14way/stellar-creator-store" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
        <div className="wordmark-giant" aria-hidden="true">
          Creator Store
        </div>
      </footer>
    </WalletProvider>
  );
}
