import React, { ChangeEvent, useEffect, useState } from "react";
import { render } from "react-dom";
import "./styles.scss";

import { Typename, UserNode } from "./model/user";
import { Toast } from "./components/Toast";
import { UserCheckIcon } from "./components/icons/UserCheckIcon";
import { UserUncheckIcon } from "./components/icons/UserUncheckIcon";
import {
  DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
  DEFAULT_TIME_BETWEEN_UNFOLLOWS,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
  DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
  DEFAULT_USERS_PER_SEARCH_CYCLE,
  CHECKS_BEFORE_REST,
  FOLLOWING_PAGE_SAFETY_LIMIT,
  DEFAULT_PROFILES_PER_BATCH,
  DEFAULT_TIME_BETWEEN_PROFILE_BATCHES,
  INSTAGRAM_HOSTNAME,
  RATE_LIMIT_COOLDOWN_SECONDS,
} from "./constants/constants";
import {
  assertUnreachable,
  fetchFriendshipsPage,
  fetchFriendshipStatus,
  getCookie,
  getCurrentPageUnfollowers,
  getUsersForDisplay,
  InstagramApiError,
  RawFriendshipUser,
  rawFriendshipUserToUserNode,
  sleep,
  unfollowUser,
} from "./utils/utils";
import { NotSearching } from "./components/NotSearching";
import { State } from "./model/state";
import { Searching } from "./components/Searching";
import { Toolbar } from "./components/Toolbar";
import { Unfollowing } from "./components/Unfollowing";
import { Timings } from "./model/timings";
import { loadCachedScanResults, loadTimings, loadWhitelist, saveCachedScanResults, saveTimings, saveWhitelist } from "./utils/whitelist-manager";
import { getInitialLanguage, Language, saveLanguage, t } from "./utils/i18n";

// A scan walks the viewer's following list in blocks (1000 accounts by
// default). Each block is loaded, then every account in it is checked one by
// one, and the scan stops so its non-followers can be unfollowed before the
// next block. All of this survives between runs of the scan effect.
interface ScanSession {
  // Cursor into the following list just after the current block.
  followingMaxId: string | undefined;
  // The following list has been fetched to its end.
  listExhausted: boolean;
  // Accounts of the current block that still have to be checked.
  pending: RawFriendshipUser[];
  blockNumber: number;
  blockTotal: number;
  blockChecked: number;
  readonly seenFollowingIds: Set<string>;
  nonFollowers: UserNode[];
  checkedCount: number;
  batchesCompleted: number;
  // Accounts unfollowed since `followingMaxId` was saved (they shift the
  // offset-based cursor back).
  unfollowedSinceCursor: number;
  finished: boolean;
}

const newScanSession = (): ScanSession => ({
  followingMaxId: undefined,
  listExhausted: false,
  pending: [],
  blockNumber: 0,
  blockTotal: 0,
  blockChecked: 0,
  seenFollowingIds: new Set<string>(),
  nonFollowers: [],
  checkedCount: 0,
  batchesCompleted: 0,
  unfollowedSinceCursor: 0,
  finished: false,
});

const LOCAL_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocalPreview = LOCAL_PREVIEW_HOSTS.has(location.hostname);

const _avatarUrl = (seed: string): string =>
  `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=0f172a,1f2937,312e81&fontFamily=Verdana`;

const _createPreviewUser = (
  id: string,
  username: string,
  fullName: string,
  options: { readonly isPrivate?: boolean; readonly isVerified?: boolean; readonly followsViewer?: boolean } = {},
): UserNode => ({
  id,
  username,
  full_name: fullName,
  profile_pic_url: _avatarUrl(username),
  is_private: options.isPrivate ?? false,
  is_verified: options.isVerified ?? false,
  followed_by_viewer: true,
  follows_viewer: options.followsViewer ?? false,
  requested_by_viewer: false,
  reel: {
    id,
    expiring_at: 0,
    has_pride_media: false,
    latest_reel_media: 0,
    seen: null,
    owner: {
      __typename: Typename.GraphUser,
      id,
      profile_pic_url: _avatarUrl(username),
      username,
    },
  },
});

const _getPreviewUsers = (): readonly UserNode[] => [
  _createPreviewUser("1", "alina.frames", "Alina Moreno", { isVerified: true }),
  _createPreviewUser("2", "brassandbone", "Theo Walsh", { isPrivate: true }),
  _createPreviewUser("3", "citrus.archive", "Mara Kim", { followsViewer: true }),
  _createPreviewUser("4", "dawnledger", "Jon Bell", { isPrivate: true }),
  _createPreviewUser("5", "elias.market", "Elias Noor", { isVerified: true }),
  _createPreviewUser("6", "fieldnotes.studio", "Nadia Reyes"),
  _createPreviewUser("7", "glint.supply", "Remy Park", { followsViewer: true }),
  _createPreviewUser("8", "harbor.sequence", "Ivy Chen", { isPrivate: true }),
  _createPreviewUser("9", "inkline.daily", "Sofia Grant"),
  _createPreviewUser("10", "juniper.signal", "Cal Reed", { isVerified: true }),
  _createPreviewUser("11", "keystone.labs", "Mina Torres"),
  _createPreviewUser("12", "lowlight.club", "Owen Voss", { isPrivate: true }),
];



function App() {
  const [state, setState] = useState<State>({
    ...(
      isLocalPreview && new URLSearchParams(location.search).get("preview") === "scanning"
        ? {
          status: "scanning",
          page: 1,
          searchTerm: "",
          currentTab: "non_whitelisted",
          percentage: 100,
          results: _getPreviewUsers(),
          selectedResults: _getPreviewUsers().slice(0, 3),
          whitelistedResults: _getPreviewUsers().slice(10, 12),
          filter: {
            showVerified: true,
            showPrivate: true,
            showWithOutProfilePicture: true,
          },
        } as State
        : { status: "initial" as const }
    ),
  });

  const [toast, setToast] = useState<{ readonly show: false } | { readonly show: true; readonly text: string }>({
    show: false,
  });

  const [timings, setTimings] = useState<Timings>(() => {
    const storedTimings = loadTimings();
    return {
      timeBetweenSearchCycles: storedTimings?.timeBetweenSearchCycles ?? DEFAULT_TIME_BETWEEN_SEARCH_CYCLES,
      timeToWaitAfterFiveSearchCycles: storedTimings?.timeToWaitAfterFiveSearchCycles ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_SEARCH_CYCLES,
      timeBetweenUnfollows: storedTimings?.timeBetweenUnfollows ?? DEFAULT_TIME_BETWEEN_UNFOLLOWS,
      timeToWaitAfterFiveUnfollows: storedTimings?.timeToWaitAfterFiveUnfollows ?? DEFAULT_TIME_TO_WAIT_AFTER_FIVE_UNFOLLOWS,
      usersPerSearchCycle: storedTimings?.usersPerSearchCycle ?? DEFAULT_USERS_PER_SEARCH_CYCLE,
      profilesPerBatch: storedTimings?.profilesPerBatch ?? DEFAULT_PROFILES_PER_BATCH,
      timeBetweenProfileBatches: storedTimings?.timeBetweenProfileBatches ?? DEFAULT_TIME_BETWEEN_PROFILE_BATCHES,
    };
  });

  // Save timings whenever they change
  useEffect(() => {
    saveTimings(timings);
  }, [timings]);

  const [cachedScan, setCachedScan] = useState<{ readonly results: readonly UserNode[]; readonly timestamp: number } | null>(() =>
    loadCachedScanResults(),
  );

  const [lang, setLang] = useState<Language>(() => getInitialLanguage());

  const [scanningPaused, setScanningPaused] = useState(false);
  const scanningPausedRef = React.useRef(false);

  // State kept between batches of a scan (see the scan effect below).
  const scanSessionRef = React.useRef<ScanSession | null>(null);
  // Bumped to (re)start the scan effect for the next batch while the status
  // stays "scanning".
  const [scanRunToken, setScanRunToken] = useState(0);

  const pauseScan = () => {
    setScanningPaused(prev => {
      const next = !prev;
      scanningPausedRef.current = next;
      return next;
    });
  };

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    saveLanguage(newLang);
  };


  let isActiveProcess: boolean;
  switch (state.status) {
    case "initial":
      isActiveProcess = false;
      break;
    case "scanning":
      isActiveProcess = Boolean(state.isScanningActive);
      break;
    case "unfollowing":
      isActiveProcess = state.percentage < 100;
      break;
    default:
      assertUnreachable(state);
  }

  const onLoadCached = () => {
    if (!cachedScan || cachedScan.results.length === 0) {
      return;
    }
    const whitelistedResults = loadWhitelist();
    scanSessionRef.current = null;
    setState({
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 100,
      isScanningActive: false,
      results: cachedScan.results,
      selectedResults: [],
      whitelistedResults,
      filter: {
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    });
    setToast({
      show: true,
      text: t(lang, "loadedFromCache", cachedScan.results.length),
    });
  };

  const onScan = async () => {
    if (state.status !== "initial") {
      return;
    }
    if (isLocalPreview) {
      const previewUsers = _getPreviewUsers();
      setState({
        status: "scanning",
        page: 1,
        searchTerm: "",
        currentTab: "non_whitelisted",
        percentage: 100,
        isScanningActive: false,
        results: previewUsers,
        selectedResults: previewUsers.slice(0, 3),
        whitelistedResults: previewUsers.slice(10, 12),
        filter: {
          showVerified: true,
          showPrivate: true,
          showWithOutProfilePicture: true,
        },
      });
      return;
    }
    const whitelistedResults = loadWhitelist();
    scanSessionRef.current = null;
    setScanRunToken(token => token + 1);
    setState({
      status: "scanning",
      page: 1,
      searchTerm: "",
      currentTab: "non_whitelisted",
      percentage: 0,
      isScanningActive: true,
      results: [],
      selectedResults: [],
      whitelistedResults,
      filter: {
        showVerified: true,
        showPrivate: true,
        showWithOutProfilePicture: true,
      },
    });
  };

  // Starts the next batch of the following list from where the last one stopped.
  const onContinueScan = () => {
    const session = scanSessionRef.current;
    if (session === null || session.finished || isActiveProcess) {
      return;
    }
    setScanRunToken(token => token + 1);
    setState(prevState => {
      if (prevState.status === "scanning") {
        return { ...prevState, isScanningActive: true, batchReady: false, selectedResults: [] };
      }
      if (prevState.status === "unfollowing") {
        return { ...scanningStateFromSession(session, prevState.searchTerm), isScanningActive: true, batchReady: false };
      }
      return prevState;
    });
  };

  // Leaves the unfollow log and goes back to the results of the scan so far.
  const onBackToResults = () => {
    const session = scanSessionRef.current;
    if (state.status !== "unfollowing" || isActiveProcess) {
      return;
    }
    if (session === null) {
      setState({ status: "initial" });
      return;
    }
    setState(scanningStateFromSession(session, state.searchTerm));
  };

  const scanningStateFromSession = (session: ScanSession, searchTerm: string): State => ({
    status: "scanning",
    page: 1,
    searchTerm,
    currentTab: "non_whitelisted",
    percentage: session.finished ? 100 : session.blockTotal > 0 ? Math.min(99, Math.round((100 * session.blockChecked) / session.blockTotal)) : 0,
    isScanningActive: false,
    batchReady: !session.finished,
    blockInterrupted: session.pending.length > 0,
    blockNumber: session.blockNumber,
    blockChecked: session.blockChecked,
    blockTotal: session.blockTotal,
    batchesCompleted: session.batchesCompleted,
    totalScanned: session.checkedCount,
    // A copy: the session keeps appending to its own array during the scan.
    results: [...session.nonFollowers],
    selectedResults: [],
    whitelistedResults: loadWhitelist(),
    filter: {
      showVerified: true,
      showPrivate: true,
      showWithOutProfilePicture: true,
    },
  });

  const handleScanFilter = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    if (state.selectedResults.length > 0) {
      if (!confirm("Changing filter options will clear selected users")) {
        // Force re-render. Bit of a hack but had an issue where the checkbox state was still
        // changing in the UI even even when not confirming. So updating the state fixes this
        // by synchronizing the checkboxes with the filter statuses in the state.
        setState({ ...state });
        return;
      }
    }
    setState({
      ...state,
      // Make sure to clear selected results when changing filter options. This is to avoid having
      // users selected in the unfollow queue but not visible in the UI, which would be confusing.
      selectedResults: [],
      filter: {
        ...state.filter,
        [e.currentTarget.name]: e.currentTarget.checked,
      },
    });
  };

  const handleUnfollowFilter = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "unfollowing") {
      return;
    }
    setState({
      ...state,
      filter: {
        ...state.filter,
        [e.currentTarget.name]: e.currentTarget.checked,
      },
    });
  };

  const toggleUser = (newStatus: boolean, user: UserNode) => {
    if (state.status !== "scanning") {
      return;
    }
    if (newStatus) {
      setState({
        ...state,
        selectedResults: [...state.selectedResults, user],
      });
    } else {
      setState({
        ...state,
        selectedResults: state.selectedResults.filter(result => result.id !== user.id),
      });
    }
  };

  const toggleAllUsers = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    const displayed = getUsersForDisplay(
      state.results,
      state.whitelistedResults,
      state.currentTab,
      state.searchTerm,
      state.filter,
    );
    if (e.currentTarget.checked) {
      const currentIds = new Set(state.selectedResults.map(u => u.id));
      const toAdd = displayed.filter(u => !currentIds.has(u.id));
      setState({
        ...state,
        selectedResults: [...state.selectedResults, ...toAdd],
      });
    } else {
      const displayedIds = new Set(displayed.map(u => u.id));
      setState({
        ...state,
        selectedResults: state.selectedResults.filter(u => !displayedIds.has(u.id)),
      });
    }
  };

  // it will work the same as toggleAllUsers, but it will select everyone on the current page.
  const toggleCurrentePageUsers = (e: ChangeEvent<HTMLInputElement>) => {
    if (state.status !== "scanning") {
      return;
    }
    const pageUsers = getCurrentPageUnfollowers(
      getUsersForDisplay(
        state.results,
        state.whitelistedResults,
        state.currentTab,
        state.searchTerm,
        state.filter,
      ),
      state.page,
    );
    if (e.currentTarget.checked) {
      const currentIds = new Set(state.selectedResults.map(u => u.id));
      const toAdd = pageUsers.filter(u => !currentIds.has(u.id));
      setState({
        ...state,
        selectedResults: [...state.selectedResults, ...toAdd],
      });
    } else {
      const pageUserIds = new Set(pageUsers.map(u => u.id));
      setState({
        ...state,
        selectedResults: state.selectedResults.filter(u => !pageUserIds.has(u.id)),
      });
    }
  };

  const onWhitelistUpdate = (updatedWhitelist: readonly UserNode[]) => {
    saveWhitelist(updatedWhitelist);
    if (state.status === "scanning") {
      setState({
        ...state,
        whitelistedResults: updatedWhitelist,
      });
    }
  };

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Prompt user if he tries to leave while in the middle of a process (searching / unfollowing / etc..)
      // This is especially good for avoiding accidental tab closing which would result in a frustrating experience.
      if (!isActiveProcess) {
        return;
      }

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      e = e || window.event;

      // `e` Might be undefined in older browsers, so silence linter for this one.
      // For IE and Firefox prior to version 4
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (e) {
        e.returnValue = "Changes you made may not be saved.";
      }

      // For Safari
      return "Changes you made may not be saved.";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActiveProcess, state]);

  useEffect(() => {
    // Runs a request, retrying with backoff on rate limits / network errors.
    // `blocked` is true when retries were exhausted for such a transient error
    // (the scan should stop and can be continued later); false means a
    // different, non-retryable error (e.g. 404 / unavailable account).
    type RetryResult<T> =
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly blocked: boolean };

    const withRetry = async <T,>(label: string, op: () => Promise<T>): Promise<RetryResult<T>> => {
      let retries = 0;
      const maxRetries = 3;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        try {
          return { ok: true, value: await op() };
        } catch (e: any) {
          const status = e?.status;
          const message = String(e?.message ?? "");
          const isRateLimitOrSoftBlock =
            (e instanceof InstagramApiError || e?.name === "InstagramApiError") &&
            (status === 429 || /feedback_required|checkpoint|rate limit|please wait/i.test(message));
          const isNetworkError = e instanceof TypeError || /fetch|network/i.test(message);
          const isTransient = isRateLimitOrSoftBlock || isNetworkError;

          if (isTransient && retries < maxRetries) {
            retries++;
            const waitSeconds = isRateLimitOrSoftBlock
              ? RATE_LIMIT_COOLDOWN_SECONDS * 2 * retries
              : 5 * retries;
            for (let sec = waitSeconds; sec > 0; sec--) {
              setToast({
                show: true,
                text: t(lang, "rateLimitPause", sec),
              });
              await sleep(1000);
            }
            setToast({ show: false });
            continue;
          }
          console.error(`${label} failed:`, e);
          return { ok: false, blocked: isTransient };
        }
      }
    };

    const blockSize = Math.max(1, timings.profilesPerBatch ?? DEFAULT_PROFILES_PER_BATCH);
    const usersPerRequest = Math.max(1, timings.usersPerSearchCycle ?? DEFAULT_USERS_PER_SEARCH_CYCLE);
    const restDuration = Math.max(0, timings.timeBetweenProfileBatches ?? DEFAULT_TIME_BETWEEN_PROFILE_BATCHES);
    let requestsSinceRest = 0;

    // Waits between two requests: a short random gap every time, and a longer
    // rest every CHECKS_BEFORE_REST requests. Also honours the Pause button.
    const paceRequest = async () => {
      while (scanningPausedRef.current) {
        await sleep(1000);
      }

      await sleep(Math.floor(Math.random() * 700) + 300);
      await sleep(Math.floor(Math.random() * (timings.timeBetweenSearchCycles - timings.timeBetweenSearchCycles * 0.7)) + timings.timeBetweenSearchCycles);

      requestsSinceRest++;
      if (requestsSinceRest >= CHECKS_BEFORE_REST && restDuration > 0) {
        requestsSinceRest = 0;
        // +/- 10% jitter so the rests don't follow an exact pattern.
        const rest = Math.round(restDuration * (0.9 + Math.random() * 0.2));
        for (let remaining = Math.round(rest / 1000); remaining > 0; remaining--) {
          while (scanningPausedRef.current) {
            await sleep(1000);
          }
          setToast({ show: true, text: t(lang, "sleepingSafety", remaining) });
          await sleep(1000);
        }
        setToast({ show: false });
      }
    };

    const blockProgress = (session: ScanSession) =>
      session.blockTotal > 0 ? Math.min(99, Math.round((100 * session.blockChecked) / session.blockTotal)) : 0;

    // Loads the next block of the following list into `session.pending`.
    // Returns false if Instagram could not be reached.
    const loadNextBlock = async (session: ScanSession): Promise<boolean> => {
      // Instagram pages the following list with a numeric offset. Accounts
      // unfollowed since the cursor was saved shift everything after them
      // back, so rewind the offset by that many; anything seen twice is skipped.
      let maxId = session.followingMaxId;
      if (maxId !== undefined && /^\d+$/.test(maxId) && session.unfollowedSinceCursor > 0) {
        maxId = String(Math.max(0, Number(maxId) - session.unfollowedSinceCursor));
      }

      const block: RawFriendshipUser[] = [];
      let pagesFetched = 0;
      let reachedEnd = false;
      while (block.length < blockSize) {
        const count = Math.max(1, Math.min(usersPerRequest, blockSize - block.length));
        const result = await withRetry("following request", () => fetchFriendshipsPage("following", maxId, count));
        if (!result.ok) {
          return false;
        }
        const page = result.value;
        const pageUsers = page.users ?? [];
        for (const user of pageUsers) {
          const userId = String(user.pk_id ?? user.pk);
          if (session.seenFollowingIds.has(userId)) {
            continue;
          }
          session.seenFollowingIds.add(userId);
          block.push(user);
        }
        setToast({ show: true, text: t(lang, "loadingBlock", session.blockNumber + 1, block.length) });

        const hasMore = Boolean(page.next_max_id) && page.has_more !== false;
        if (!hasMore || pageUsers.length === 0) {
          reachedEnd = true;
          break;
        }
        maxId = page.next_max_id as string;
        pagesFetched++;
        if (pagesFetched >= FOLLOWING_PAGE_SAFETY_LIMIT) {
          reachedEnd = true;
          break;
        }
        await paceRequest();
      }

      session.followingMaxId = maxId;
      session.unfollowedSinceCursor = 0;
      session.listExhausted = reachedEnd;
      session.pending = block;
      session.blockNumber++;
      session.blockTotal = block.length;
      session.blockChecked = 0;
      return true;
    };

    const scan = async () => {
      if (state.status !== "scanning" || !state.isScanningActive || isLocalPreview) {
        return;
      }

      const viewerId = getCookie("ds_user_id");
      if (viewerId === null) {
        setState(prevState =>
          prevState.status === "scanning" ? { ...prevState, isScanningActive: false } : prevState,
        );
        setToast({ show: true, text: t(lang, "scanFailedFollowing") });
        return;
      }

      if (scanSessionRef.current === null) {
        scanSessionRef.current = newScanSession();
      }
      const session = scanSessionRef.current;

      const stopBlock = (interrupted: boolean) => {
        setState(prevState =>
          prevState.status === "scanning"
            ? {
                ...prevState,
                isScanningActive: false,
                batchReady: true,
                blockInterrupted: interrupted,
                blockNumber: session.blockNumber,
                blockChecked: session.blockChecked,
                blockTotal: session.blockTotal,
                batchesCompleted: session.batchesCompleted,
                totalScanned: session.checkedCount,
                percentage: blockProgress(session),
              }
            : prevState,
        );
      };

      // Step 1: load a new block, unless the current one was cut short and
      // still has accounts to check.
      if (session.pending.length === 0) {
        if (!(await loadNextBlock(session))) {
          if (session.checkedCount === 0) {
            setState(prevState =>
              prevState.status === "scanning" ? { ...prevState, isScanningActive: false } : prevState,
            );
            setToast({ show: true, text: t(lang, "scanFailedFollowing") });
          } else {
            stopBlock(false);
            setToast({ show: true, text: t(lang, "blockLoadFailed") });
          }
          return;
        }
        setState(prevState =>
          prevState.status === "scanning"
            ? {
                ...prevState,
                blockNumber: session.blockNumber,
                blockChecked: 0,
                blockTotal: session.blockTotal,
                percentage: 0,
              }
            : prevState,
        );
        if (session.pending.length > 0) {
          await paceRequest();
        }
      }

      // Step 2: check every account of the block. Each answer is final on its
      // own, so a block cut short by Instagram still yields correct results.
      while (session.pending.length > 0) {
        const user = session.pending[0];
        const userId = String(user.pk_id ?? user.pk);
        const result = await withRetry(`friendship check for ${user.username}`, () => fetchFriendshipStatus(userId));

        if (!result.ok && result.blocked) {
          stopBlock(true);
          setToast({
            show: true,
            text: t(lang, "blockInterruptedToast", session.blockNumber, session.blockChecked, session.blockTotal),
          });
          return;
        }

        session.pending.shift();
        session.blockChecked++;
        session.checkedCount++;

        // Non-retryable errors (deleted / unavailable account) are skipped.
        // An account the viewer no longer follows is not listed either.
        const newNonFollower =
          result.ok && result.value.followed_by === false && result.value.following !== false
            ? rawFriendshipUserToUserNode(user, false)
            : null;
        if (newNonFollower !== null) {
          session.nonFollowers.push(newNonFollower);
        }

        setState(prevState =>
          prevState.status === "scanning"
            ? {
                ...prevState,
                results: newNonFollower !== null ? [...prevState.results, newNonFollower] : prevState.results,
                totalScanned: session.checkedCount,
                blockChecked: session.blockChecked,
                percentage: blockProgress(session),
              }
            : prevState,
        );
        setToast({
          show: true,
          text: t(lang, "checkingBlockProgress", session.blockNumber, session.blockChecked, session.blockTotal),
        });

        if (session.pending.length > 0) {
          await paceRequest();
        }
      }

      // Step 3: the block is done.
      session.batchesCompleted++;
      if (session.listExhausted) {
        session.finished = true;
        saveCachedScanResults(session.nonFollowers);
        setCachedScan({ results: session.nonFollowers, timestamp: Date.now() });
        setState(prevState =>
          prevState.status === "scanning"
            ? {
                ...prevState,
                percentage: 100,
                isScanningActive: false,
                batchReady: false,
                blockInterrupted: false,
                scanIncomplete: false,
                results: [...session.nonFollowers],
                totalScanned: session.checkedCount,
              }
            : prevState,
        );
        setToast({ show: true, text: t(lang, "scanCompleted") });
        return;
      }

      stopBlock(false);
      setToast({
        show: true,
        text: t(lang, "batchReadyToast", session.blockNumber, session.blockTotal, session.nonFollowers.length),
      });
    };
    scan();
    // Dependency array not entirely legit, but works this way. TODO: Find a way to fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, scanRunToken]);

  useEffect(() => {
    const unfollow = async () => {
      if (state.status !== "unfollowing" || isLocalPreview) {
        return;
      }

      const csrftoken = getCookie("csrftoken");
      if (csrftoken === null) {
        throw new Error("csrftoken cookie is null");
      }

      let counter = 0;
      for (const user of state.selectedResults) {
        counter += 1;
        // Fix: Changed from Math.floor to Math.round to ensure progress reaches 100%
        // Math.floor would leave progress at 99% when near completion
        const percentage = Math.round((counter / state.selectedResults.length) * 100);
        try {
          const result = await unfollowUser(user, csrftoken);
          const success = result.outcome === "unfollowed";
          const session = scanSessionRef.current;
          if (success && session !== null) {
            // Drop it from the batch results and account for the shifted cursor.
            session.nonFollowers = session.nonFollowers.filter(u => u.id !== user.id);
            session.unfollowedSinceCursor++;
          }
          const isActionBlocked = result.outcome === "blocked";
          if (!success) {
            console.warn(`Unfollow for ${user.username} not confirmed: ${result.detail}`);
          }
          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                {
                  user,
                  unfollowedSuccessfully: success,
                },
              ],
            };
          });

          if (isActionBlocked) {
            setToast({
              show: true,
              text: t(lang, "actionBlockedWarning"),
            });
            break;
          }
        } catch (e) {
          console.error(e);
          setState(prevState => {
            if (prevState.status !== "unfollowing") {
              return prevState;
            }
            return {
              ...prevState,
              percentage,
              unfollowLog: [
                ...prevState.unfollowLog,
                {
                  user,
                  unfollowedSuccessfully: false,
                },
              ],
            };
          });
        }
        // If unfollowing the last user in the list, no reason to wait.
        if (user === state.selectedResults[state.selectedResults.length - 1]) {
          break;
        }
        await sleep(Math.floor(Math.random() * (timings.timeBetweenUnfollows * 1.2 - timings.timeBetweenUnfollows)) + timings.timeBetweenUnfollows);

        if (counter % 5 === 0) {
          setToast({
            show: true,
            text: t(lang, "sleepingSafety", `${Math.round(timings.timeToWaitAfterFiveUnfollows / 60000)}m`),
          });
          await sleep(timings.timeToWaitAfterFiveUnfollows);
        }
        setToast({ show: false });
      }
    };
    unfollow();
    // Dependency array not entirely legit, but works this way. TODO: Find a way to fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  let markup: React.JSX.Element;
  switch (state.status) {
    case "initial":
      markup = <NotSearching onScan={onScan} lang={lang} cachedScan={cachedScan} onLoadCached={onLoadCached}></NotSearching>;
      break;

    case "scanning": {
      markup = <Searching
        state={state}
        handleScanFilter={handleScanFilter}
        toggleUser={toggleUser}
        pauseScan={pauseScan}
        onContinueScan={onContinueScan}
        setState={setState}
        scanningPaused={scanningPaused}
        UserCheckIcon={UserCheckIcon}
        UserUncheckIcon={UserUncheckIcon}
        lang={lang}
      ></Searching>;
      break;
    }

    case "unfollowing":
      markup = <Unfollowing
        state={state}
        handleUnfollowFilter={handleUnfollowFilter}
        canContinueScan={scanSessionRef.current !== null && !scanSessionRef.current.finished}
        onContinueScan={onContinueScan}
        onBackToResults={onBackToResults}
        lang={lang}
      ></Unfollowing>;
      break;

    default:
      assertUnreachable(state);
  }

  const showScanWarning = state.status === "scanning" && state.results.length === 0;

  return (
    <main id="main" role="main" className={`iu ${showScanWarning ? "has-scan-warning" : ""}`}>
      <section className="overlay">
        <Toolbar
          state={state}
          setState={setState}
          isActiveProcess={isActiveProcess}
          toggleAllUsers={toggleAllUsers}
          toggleCurrentePageUsers={toggleCurrentePageUsers}
          setTimings={setTimings}
          currentTimings={timings}
          whitelistedUsers={state.status === "scanning" ? state.whitelistedResults : loadWhitelist()}
          onWhitelistUpdate={onWhitelistUpdate}
          lang={lang}
          onLanguageChange={handleLanguageChange}
        ></Toolbar>

        {markup}

        {toast.show && <Toast show={toast.show} message={toast.text} onClose={() => setToast({ show: false })} />}
      </section>
    </main>
  );
}

if (location.hostname !== INSTAGRAM_HOSTNAME && !isLocalPreview) {
  alert("Can be used only on Instagram routes");
} else {
  document.title = "InstagramUnfollowers";
  document.body.innerHTML = "";
  render(<App />, document.body);
}
