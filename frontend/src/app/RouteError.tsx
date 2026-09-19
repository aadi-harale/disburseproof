import { isRouteErrorResponse, Link, useRouteError } from "react-router";

import { buttonClasses } from "../components/ui/buttonStyles";
import { EmptyState } from "../components/ui/EmptyState";
import { useDocumentTitle } from "../lib/hooks";

/** Rendered for unknown URLs and for errors thrown while rendering a page. */
export function RouteError() {
  const error = useRouteError();
  // No error means the catch-all route matched: an unknown URL.
  const notFound = error === undefined || (isRouteErrorResponse(error) && error.status === 404);
  useDocumentTitle(notFound ? "Page not found" : "Error");
  return (
    <div className="mx-auto max-w-7xl px-4 py-16">
      <EmptyState
        icon="alert"
        title={notFound ? "Page not found" : "Something went wrong on this page"}
        body={
          notFound
            ? "The address may be mistyped, or the run may belong to another deployment. Your runs are listed under My runs."
            : String(error instanceof Error ? error.message : "")
        }
        action={
          <Link to="/" className={buttonClasses("primary", "md")}>
            Back to home
          </Link>
        }
      />
    </div>
  );
}
