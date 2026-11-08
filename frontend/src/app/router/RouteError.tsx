import { isRouteErrorResponse, Link, useRouteError } from "react-router";

import { Button } from "@/components/ui/button";

export function RouteError() {
  const err = useRouteError();
  const msg = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : "Unexpected error";
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="font-display text-5xl font-extrabold text-brand-800">Rain stopped play</p>
        <p className="mt-3 text-ink-500">{msg}</p>
        <Link to="/"><Button className="mt-6">Back to home</Button></Link>
      </div>
    </div>
  );
}
