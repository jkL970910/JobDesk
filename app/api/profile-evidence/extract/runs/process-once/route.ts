import {
  handleProfileEvidenceExtractionProcessOnceRequest,
} from "../../../../../../src/server/profile-evidence-extraction-process-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleProfileEvidenceExtractionProcessOnceRequest(request);
}

export async function POST(request: Request) {
  return handleProfileEvidenceExtractionProcessOnceRequest(request);
}
