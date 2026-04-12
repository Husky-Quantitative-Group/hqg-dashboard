import { useEffect, useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { coreApi } from "./api/core";
import axios from "axios";
import { UserProvider, useUser } from "./context/UserConext";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/hqg-logo.png", type: "image/png" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap",
  },
];

const githubPagesPathFixScript = `
  (function(location) {
    if (location.search.startsWith('?p=')) {
      var encoded = location.search.slice(3);
      var decodedPath = '';
      try {
        decodedPath = decodeURIComponent(encoded);
      } catch (_err) {
        decodedPath = '/';
      }

      if (decodedPath && decodedPath.charAt(0) === '/') {
        window.history.replaceState(null, '', decodedPath);
      }
      return;
    }

    // Legacy fallback format kept for backward compatibility.
    if (location.search.startsWith('?/')) {
      var decoded = location.search
        .slice(2)
        .split('&')
        .map(function(part) {
          return part.replace(/~and~/g, '&');
        })
        .join('?');

      window.history.replaceState(
        null,
        '',
        location.pathname + decoded + location.hash
      );
    }
  })(window.location);
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: githubPagesPathFixScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const { setUser } = useUser();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isCancelled = false;
    const run = async () => {
      try {
        const response = await coreApi.get("/auth/me");
        const data = response.data as { netid?: string; roles?: string[]; display_name?: string };
        if (!isCancelled) {
          setUser(
            data?.netid
              ? {
                  netid: data.netid,
                  roles: Array.isArray(data.roles) ? data.roles : [],
                  display_name: data.display_name,
                }
              : null
          );
          setLoading(false);
        }
      } catch (error) {
        if (isCancelled) return;
        setUser(null);
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status === 403) {
          navigate("/apply", { replace: true });
        } else {
          navigate("/login", { replace: true });
        }
        setLoading(false);
      }
    };

    run();
    return () => {
      isCancelled = true;
    };
  }, [navigate, setUser]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-700">
        Checking session...
      </div>
    );
  }
  return <Outlet />;
}

export default function App() {
  return (
    <UserProvider>
      <AppContent />
    </UserProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
