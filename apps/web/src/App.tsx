import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter, redirect, useParams } from "@tanstack/react-router";
import { canSeeView, homeView, VIEWS, type ViewId } from "@ostcrm/domain";
import { Ctx, useApp, type AppContext } from "./context.js";
import { ErrorBoundary } from "./layout/ErrorBoundary.js";
import { Header } from "./layout/Header.js";
import { NotPorted, SCREENS } from "./views/index.js";
import { DrawerHost } from "./views/CompanyDrawer.js";

const isView = (v: string): v is ViewId => VIEWS.some(x => x.id === v);

function Shell() {
  const params = useParams({ strict: false }) as { view?: string };
  const current = params.view && isView(params.view) ? params.view : null;
  const { api } = useApp();
  return (
    <>
      <Header current={current} />
      <main className="wrap">
        <ErrorBoundary api={api} resetKey={current ?? ""}>
          <Outlet />
          <DrawerHost />
        </ErrorBoundary>
      </main>
    </>
  );
}

function Screen() {
  const { view } = useParams({ from: "/$view" });
  const Comp = SCREENS[view as ViewId];
  return Comp ? <Comp /> : <NotPorted view={view as ViewId} />;
}

export function buildRouter(ctx: AppContext) {
  const root = createRootRoute({ component: Shell });
  const index = createRoute({
    getParentRoute: () => root, path: "/",
    beforeLoad: () => { throw redirect({ to: "/$view", params: { view: homeView(ctx.me.role) } }); }
  });
  const view = createRoute({
    getParentRoute: () => root, path: "/$view", component: Screen,
    // `?co=<company id>` opens the company drawer over any screen.
    validateSearch: (s: Record<string, unknown>): { co?: string } => (typeof s.co === "string" && /^([0-9a-f-]{36}|new)$/.test(s.co) ? { co: s.co } : {}),
    // Screens a role cannot see send it to its home screen. The API enforces access regardless.
    beforeLoad: ({ params }) => {
      if (!isView(params.view) || !canSeeView(ctx.me.role, params.view)) throw redirect({ to: "/$view", params: { view: homeView(ctx.me.role) } });
    }
  });
  return createRouter({ routeTree: root.addChildren([index, view]) });
}

export function App({ ctx }: { ctx: AppContext }) {
  // Network failures retry twice; refusals and validation errors never retry.
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (n, e) => n < 2 && (e as { status?: number }).status === 0, staleTime: 15_000 } } }));
  const [router] = useState(() => buildRouter(ctx));
  return (
    <Ctx.Provider value={ctx}>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Ctx.Provider>
  );
}
