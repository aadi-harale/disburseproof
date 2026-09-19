import { createBrowserRouter } from "react-router";

import { BatchDetailPage } from "../features/batches/BatchDetailPage";
import { BatchesPage } from "../features/batches/BatchesPage";
import { ComparePage } from "../features/compare/ComparePage";
import { ArchitecturePage } from "../features/docs/ArchitecturePage";
import { DocsPage } from "../features/docs/DocsPage";
import { EvidencePage } from "../features/evidence/EvidencePage";
import { RaceLabPage } from "../features/race/RaceLabPage";
import { ReceiptPage } from "../features/receipts/ReceiptPage";
import { RunPage } from "../features/runs/RunPage";
import { RunsHistoryPage } from "../features/runs/RunsHistoryPage";
import { HomePage } from "../features/story/HomePage";
import { NewTestPage } from "../features/newtest/NewTestPage";
import { AppLayout } from "./AppLayout";
import { RouteError } from "./RouteError";

/** Deep-linkable routes. Amplify rewrites unknown paths to index.html so these load directly. */
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/new", element: <NewTestPage /> },
      { path: "/runs", element: <RunsHistoryPage /> },
      { path: "/runs/:runId", element: <RunPage /> },
      { path: "/runs/:runId/students/:beneficiaryId", element: <RunPage /> },
      { path: "/runs/:runId/receipt", element: <ReceiptPage /> },
      { path: "/compare", element: <ComparePage /> },
      { path: "/evidence", element: <EvidencePage /> },
      { path: "/architecture", element: <ArchitecturePage /> },
      { path: "/docs", element: <DocsPage /> },
      { path: "/batches", element: <BatchesPage /> },
      { path: "/race", element: <RaceLabPage /> },
      { path: "/batches/:batchId", element: <BatchDetailPage /> },
      { path: "*", element: <RouteError /> },
    ],
  },
]);
