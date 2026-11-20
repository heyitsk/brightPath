import type { NewsDateBasis, NewsSourceKind } from "../../../generated/prisma/client";

/** A notice as found on a page or feed, before it is stored. Newest first, as the source lists them. */
export interface Candidate {
  title: string;
  /** Already absolute and normalised. */
  url: string;
  sourcePublishedAt: Date | null;
  dateBasis: NewsDateBasis;
  snippet?: string | null;
}

export interface ExtractInput {
  /** The response body as text. */
  body: string;
  /** The address that was fetched (used to resolve relative links). */
  url: string;
  config: Record<string, unknown>;
  now: Date;
}

export class AdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterError";
  }
}

export type Adapter = (input: ExtractInput) => Candidate[];

/** Kinds that have an adapter today. HTML kinds arrive in later steps (N2, N5). */
export type SupportedKind = Extract<NewsSourceKind, "RSS" | "WP_REST">;
