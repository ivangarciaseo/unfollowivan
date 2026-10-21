export interface Timings {
  timeBetweenSearchCycles: number;
  timeToWaitAfterFiveSearchCycles: number;
  timeBetweenUnfollows: number;
  timeToWaitAfterFiveUnfollows: number;
  usersPerSearchCycle?: number;
  blockSize?: number;
  timeBetweenProfileBatches?: number;
}
