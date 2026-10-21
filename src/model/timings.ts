export interface Timings {
  timeBetweenSearchCycles: number;
  timeToWaitAfterFiveSearchCycles: number;
  timeBetweenUnfollows: number;
  timeToWaitAfterFiveUnfollows: number;
  usersPerSearchCycle?: number;
  profilesPerBatch?: number;
  timeBetweenProfileBatches?: number;
}
