import { BadgeDollarSign } from "lucide-react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { All } from "./pages/All";
import { Dashboard } from "./pages/Dashboard";
import { Home } from "./pages/Home";
import { Library } from "./pages/Library";
import { ProductPage } from "./pages/Product";
import { Sell } from "./pages/Sell";
import { Shop } from "./pages/Shop";
import { EXPLORER, STORE_ID } from "./config";
import { Logo } from "./ui";
import { explain } from "./wallet";
import { short, useWallet, WalletProvider } from "./useWallet";

const REPO = "https://github.com/big14way/stellar-creator-store";

function Header() {
  const { wallet, stellar, restoring, signIn } = useWallet();
  const [signInError, setSignInError] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const shown = wallet ?? stellar;
  const here = (path: string) => (location === path || location.startsWith(`${path}/`) ? "is-here" : undefined);
  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="container">
        <Link href="/" className="brand">
          <Logo />
          Paperstall
        </Link>
        <nav>
          <Link href="/shop" className={`secondary ${here("/shop") ?? ""}`}>
            Shop
          </Link>
          <Link href="/sell" className={here("/sell")}>
            Sell
          </Link>
          <Link href="/library" className={here("/library")}>
            Library
          </Link>
          <Link href="/dashboard" className={`secondary ${here("/dashboard") ?? ""}`}>
            Dashboard
          </Link>
          {restoring ? null : shown ? (
            <Link href={wallet ? "/dashboard" : "/library"} className="chip" title={shown} data-testid="wallet">
              <span className="dot" />
              {short(shown)}
            </Link>
          ) : (
            <button
              className="chip"
              onClick={() => {
                setSignInError(null);
                signIn().catch((err) => setSignInError(explain(err instanceof Error ? err.message : String(err))));
              }}
              data-testid="sign-in"
              title={signInError ?? undefined}
            >
              <span className="dot" />
              Sign in
            </button>
          )}
          <a href="/#free" className="free-btn secondary">
            <BadgeDollarSign size={14} /> Test USDC
          </a>
          {signInError && !shown && (
            <span className="header-error" role="alert">
              {signInError}
            </span>
          )}
        </nav>
      </div>
    </header>
  );
}

function LocalTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const at = (tz: string) => now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return (
    <span className="local-time mono">
      <i /> Lagos {at("Africa/Lagos")} · Accra {at("Africa/Accra")}
    </span>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link href="/" className="brand">
            <Logo />
            Paperstall
          </Link>
          <p>
            A creator store for Nigeria and Ghana. Payments settle in USDC on Stellar testnet; a smart contract splits every
            sale the moment it happens.
          </p>
          <LocalTime />
        </div>
        <div className="footer-col">
          <span className="mono">Shop</span>
          <Link href="/shop">The shelf</Link>
          <Link href="/c/demo">Demo shop</Link>
          <Link href="/library">Your library</Link>
        </div>
        <div className="footer-col">
          <span className="mono">Sell</span>
          <Link href="/sell">Start selling</Link>
          <Link href="/dashboard">Dashboard</Link>
          <a href="/#free">Free test USDC</a>
        </div>
        <div className="footer-col">
          <span className="mono">Build</span>
          <a href={`${EXPLORER}/contract/${STORE_ID}`} target="_blank" rel="noreferrer">
            The contract
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a href={`${REPO}#how-it-uses-stellar`} target="_blank" rel="noreferrer">
            How it uses Stellar
          </a>
        </div>
        <div className="footer-col network">
          <span className="mono">Network</span>
          <p>Stellar testnet with Circle's test USDC. Prices are play money until mainnet.</p>
        </div>
      </div>
      <div className="container footer-bottom mono">
        <span>© 2026 Paperstall · MIT licence</span>
        <span>Built on Stellar · Soroban · USDC</span>
      </div>
      <div className="wordmark-giant" aria-hidden="true">
        Paperstall
      </div>
    </footer>
  );
}

/** A crash in one page shows a way back instead of a blank screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: string | null }> {
  state = { failed: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="band dark lined page-hero">
        <div className="container">
          <h1>Something went wrong on this page.</h1>
          <p className="lead">{this.state.failed}</p>
          <a href="/" className="text-link">
            Back to the store
          </a>
        </div>
      </section>
    );
  }
}

/** Resets the error boundary when the route changes. */
function Pages({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (!window.location.hash) window.scrollTo(0, 0);
    else document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }, [location]);
  return null;
}

export function App() {
  return (
    <WalletProvider>
      <ScrollToTop />
      <Header />
      <main>
        <Pages>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/shop" component={All} />
            <Route path="/sell" component={Sell} />
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/library" component={Library} />
            <Route path="/p/:id">{(params) => <ProductPage id={params.id} />}</Route>
            <Route path="/c/:id">{(params) => <Shop id={params.id} />}</Route>
            <Route>
              <section className="band dark lined page-hero">
                <div className="container">
                  <h1>Nothing on this shelf.</h1>
                  <Link href="/" className="text-link">
                    Back to the store
                  </Link>
                </div>
              </section>
            </Route>
          </Switch>
        </Pages>
      </main>
      <Footer />
    </WalletProvider>
  );
}
