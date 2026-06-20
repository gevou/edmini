import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

// A build identifier surfaced in the UI so it's unambiguous which bundle is running (stale-tab
// debugging). Vercel sets VERCEL_GIT_COMMIT_SHA on its builds; local/dev falls back to a timestamp.
const buildId =
  (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) ||
  `dev-${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

// https://workflowsdk.dev/docs/api-reference/workflow-next/with-workflow
export default withWorkflow(nextConfig);
