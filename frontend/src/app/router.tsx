import { createBrowserRouter } from "react-router";

import { BatchDetailPage } from "../features/batches/BatchDetailPage";
import { BatchesPage } from "../features/batches/BatchesPage";
import { ComparePage } from "../features/compare/ComparePage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { ReceiptPage } from "../features/receipts/ReceiptPage";
import { RunPage } from "../features/runs/RunPage";
import { RunsHistoryPage } from "../features/runs/RunsHistoryPage";
import { AppLayout } from "./AppLayout";
import { RouteError } from "./RouteError";

/** Deep-linkable routes. Amplify rewrites unknown paths to index.html so these load directly. */
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <OverviewPage /> },
      { path: "/runs", element: <RunsHistoryPage /> },
      { path: "/runs/:runId", element: <RunPage /> },
      { path: "/runs/:runId/students/:beneficiaryId", element: <RunPage /> },
      { path: "/runs/:runId/receipt", element: <ReceiptPage /> },
      { path: "/compare", element: <ComparePage /> },
      { path: "/batches", element: <BatchesPage /> },
      { path: "/batches/:batchId", element: <BatchDetailPage /> },
      { path: "*", element: <RouteError /> },
    ],
  },
]);
