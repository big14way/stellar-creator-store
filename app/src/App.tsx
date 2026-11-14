import { Link, Route, Switch } from "wouter";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { ProductPage } from "./pages/Product";
import { Sell } from "./pages/Sell";
import { short, useWallet, WalletProvider } from "./useWallet";

function Header() {
  const { wallet, restoring, signIn } = useWallet();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        Creator Store
      </Link>
      <nav>
        <Link href="/sell">Sell</Link>
        <Link href="/dashboard">Dashboard</Link>
        {restoring ? null : wallet ? (
          <span className="wallet-chip" title={wallet} data-testid="wallet">
            {short(wallet)}
          </span>
        ) : (
          <button className="link-button" onClick={() => signIn().catch(() => {})}>
            Sign in
          </button>
        )}
      </nav>
    </header>
  );
}

export function App() {
  return (
    <WalletProvider>
      <Header />
      <main className="page">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/sell" component={Sell} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/p/:id">{(params) => <ProductPage id={params.id} />}</Route>
          <Route>
            <p>Page not found.</p>
          </Route>
        </Switch>
      </main>
      <footer className="site-footer">
        Payments settle in USDC on Stellar testnet. Each sale is split by a smart contract the moment it happens.
      </footer>
    </WalletProvider>
  );
}
