import { UserNode } from "./user";
import { ScanningTab } from "./scanning-tab";
import { ScanningFilter } from "./scanning-filter";
import { UnfollowLogEntry } from "./unfollow-log-entry";
import { UnfollowFilter } from "./unfollow-filter";

type ScanningState = {
  readonly status: 'scanning';
  readonly page: number;
  readonly currentTab: ScanningTab;
  readonly searchTerm: string;
  readonly percentage: number;
  readonly results: readonly UserNode[];
  readonly whitelistedResults: readonly UserNode[];
  readonly selectedResults: readonly UserNode[];
  readonly filter: ScanningFilter;
  readonly scanIncomplete?: boolean;
  readonly isScanningActive?: boolean;
  readonly totalScanned?: number;
  // The scan stopped after a full batch of following profiles; the results so
  // far are final and can be unfollowed before continuing with the next batch.
  readonly batchReady?: boolean;
  readonly batchesCompleted?: number;
  // The current block was cut short (e.g. Instagram rate limit); the accounts
  // checked so far are final and the rest are checked on "Continue scan".
  readonly blockInterrupted?: boolean;
  readonly blockNumber?: number;
  readonly blockChecked?: number;
  readonly blockTotal?: number;
};

type UnfollowingState = {
  readonly status: 'unfollowing';
  readonly searchTerm: string;
  readonly percentage: number;
  readonly selectedResults: readonly UserNode[];
  readonly unfollowLog: readonly UnfollowLogEntry[];
  readonly filter: UnfollowFilter;
};

//TODO THIS TYPE OF MULTIPLE STATE NEEDS TO BE SEPARETED IN DIFFERENT FILES ASAP (Global state,unfollowing state, scanning state etc...)
export type State = { readonly status: 'initial' } | ScanningState | UnfollowingState;
