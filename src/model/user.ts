export interface UserNode {
    readonly id: string;
    readonly username: string;
    readonly full_name: string;
    readonly profile_pic_url: string;
    readonly is_private: boolean;
    readonly is_verified: boolean;
    readonly followed_by_viewer: boolean;
    readonly follows_viewer: boolean;
    readonly requested_by_viewer: boolean;
    // Filled in by the block scan with one extra request per account; missing
    // when Instagram did not return them (or for older cached scans).
    readonly follower_count?: number;
    readonly following_count?: number;
    // Optional: populated only for the local preview/demo data. The private
    // REST endpoints used for real scans (see utils/utils.ts) don't return
    // story-reel data, and nothing in the app reads this field, so it's kept
    // only so the preview users can still be built with a full shape.
    readonly reel?: Reel;
}

export interface Reel {
    readonly id: string;
    readonly expiring_at: number;
    readonly has_pride_media: boolean;
    readonly latest_reel_media: number;
    readonly seen: null;
    readonly owner: Owner;
}

export interface Owner {
    readonly __typename: Typename;
    readonly id: string;
    readonly profile_pic_url: string;
    readonly username: string;
}

export enum Typename {
    GraphUser = 'GraphUser',
}
