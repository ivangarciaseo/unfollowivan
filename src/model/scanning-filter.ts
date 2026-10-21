export interface ScanningFilter {
  readonly showVerified: boolean;
  readonly showPrivate: boolean;
  readonly showWithOutProfilePicture: boolean;
  // Accounts that follow you back are listed too (they have a ratio); hidden
  // only when this is false. Undefined means shown.
  readonly showFollowers?: boolean;
  // Only accounts whose followers/following ratio is at most this value.
  // null / undefined means no limit.
  readonly maxRatio?: number | null;
}
