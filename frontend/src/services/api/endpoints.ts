/**
 * Typed endpoint functions + query hooks. Request/response types come from the generated
 * OpenAPI contract (`@cm/shared`), so frontend and backend cannot drift silently.
 */
import type { S } from "@cm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, apiPaged } from "./client";

type Paged<T> = { data: T[]; meta: S<"PageMeta"> };

// ------------------------------------------------------------------ auth
export const auth = {
  register: (b: Omit<S<"RegisterIn">, "otp_channel"> & Partial<Pick<S<"RegisterIn">, "otp_channel">>) => api<S<"RegisterOut">>({ method: "POST", url: "/auth/register", data: b }),
  sendOtp: (b: Omit<S<"SendOtpIn">, "channel"> & Partial<Pick<S<"SendOtpIn">, "channel">>) => api<S<"OtpSentOut">>({ method: "POST", url: "/auth/send-otp", data: b }),
  verifyOtp: (b: S<"VerifyOtpIn">) => api<S<"TokenOut">>({ method: "POST", url: "/auth/verify-otp", data: b }),
  login: (b: S<"PasswordLoginIn">) => api<S<"TokenOut">>({ method: "POST", url: "/auth/login", data: b }),
  logout: (refresh_token: string) => api<void>({ method: "POST", url: "/auth/logout", data: { refresh_token } }),
  resetPassword: (b: S<"ResetPasswordIn">) => api<void>({ method: "POST", url: "/auth/reset-password", data: b }),
};

// ------------------------------------------------------------------ me / profiles
export const me = {
  get: () => api<S<"UserOut">>({ url: "/users/me" }),
  update: (b: S<"UpdateMeIn">) => api<S<"UserOut">>({ method: "PUT", url: "/users/me", data: b }),
  exportData: () => api<Record<string, unknown>>({ url: "/users/me/export" }),
  delete: (reason?: string) => api<void>({ method: "DELETE", url: "/users/me", data: { confirm: "DELETE", reason } }),
  player: () => api<S<"PlayerSelfOut">>({ url: "/players/me" }),
  savePlayer: (b: S<"PlayerProfileIn">) => api<S<"PlayerSelfOut">>({ method: "PUT", url: "/players/me", data: b }),
  captain: () => api<S<"CaptainOut">>({ url: "/captains/me" }),
  saveCaptain: (b: S<"CaptainProfileIn">) => api<S<"CaptainOut">>({ method: "PUT", url: "/captains/me", data: b }),
  upload: async (file: File, purpose: "profile" | "team" | "evidence") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", purpose);
    return api<S<"UploadOut">>({ method: "POST", url: "/uploads/images", data: fd });
  },
};
export const usePlayerProfile = (enabled = true) =>
  useQuery({ queryKey: ["player", "me"], queryFn: me.player, enabled, retry: false });
export const usePublicPlayer = (id: string) =>
  useQuery({ queryKey: ["player", id], queryFn: () => api<S<"PlayerPublicOut">>({ url: `/players/${id}` }) });
export const useCaptain = (id: string) =>
  useQuery({ queryKey: ["captain", id], queryFn: () => api<S<"CaptainOut">>({ url: `/captains/${id}` }) });

// ------------------------------------------------------------------ agreements
export const agreements = {
  current: () => api<S<"AgreementOut">>({ url: "/agreements/current" }),
  accept: (version: number) => api<S<"MyAgreementsOut">>({ method: "POST", url: "/agreements/acceptance", data: { version, accepted: true } }),
  mine: () => api<S<"MyAgreementsOut">>({ url: "/agreements/me" }),
};

// ------------------------------------------------------------------ dashboard
export const useDashboard = () => useQuery({ queryKey: ["dashboard"], queryFn: () => api<S<"DashboardOut">>({ url: "/dashboard" }) });

// ------------------------------------------------------------------ teams
export const teams = {
  create: (b: S<"TeamIn">) => api<S<"TeamOut">>({ method: "POST", url: "/teams", data: b }),
  update: (id: string, b: S<"TeamUpdateIn">) => api<S<"TeamOut">>({ method: "PUT", url: `/teams/${id}`, data: b }),
  addMember: (id: string, b: S<"AddMemberIn">) => api<void>({ method: "POST", url: `/teams/${id}/members`, data: b }),
  removeMember: (id: string, uid: string) => api<void>({ method: "DELETE", url: `/teams/${id}/members/${uid}` }),
  setRole: (id: string, uid: string, member_role: S<"TeamMemberRole">) =>
    api<void>({ method: "PUT", url: `/teams/${id}/members/${uid}`, data: { member_role } }),
  respond: (id: string, accept: boolean) => api<void>({ method: "POST", url: `/teams/${id}/membership/${accept ? "accept" : "decline"}` }),
};
export const useTeams = (scope: "mine" | "member" | "all", q?: string) =>
  useQuery({ queryKey: ["teams", scope, q], queryFn: () => apiPaged<S<"TeamOut">>({ url: "/teams", params: { scope, q: q || undefined, page_size: 50 } }) });
export const useTeam = (id: string) => useQuery({ queryKey: ["teams", id], queryFn: () => api<S<"TeamOut">>({ url: `/teams/${id}` }) });
export const useTeamMembers = (id: string) =>
  useQuery({ queryKey: ["teams", id, "members"], queryFn: () => api<S<"TeamMemberOut">[]>({ url: `/teams/${id}/members` }) });
export const useTeamInvites = () => useQuery({ queryKey: ["teams", "invites"], queryFn: () => api<S<"TeamOut">[]>({ url: "/teams/invitations" }) });

// ------------------------------------------------------------------ availability
export const availability = {
  create: (b: S<"AvailabilityIn">) => api<S<"AvailabilityOut">[]>({ method: "POST", url: "/availability", data: b }),
  update: (id: string, b: S<"AvailabilityUpdateIn">) => api<S<"AvailabilityOut">>({ method: "PUT", url: `/availability/${id}`, data: b }),
  remove: (id: string) => api<void>({ method: "DELETE", url: `/availability/${id}` }),
};
export const useMyAvailability = (start?: string, end?: string) =>
  useQuery({ queryKey: ["availability", start, end], queryFn: () => api<S<"AvailabilityOut">[]>({ url: "/availability/me", params: { start, end } }) });

// ------------------------------------------------------------------ matches
export type MatchListParams = { role?: "captain" | "player" | "all"; when?: "upcoming" | "past" | "all"; team_id?: string; status?: string };
export const matches = {
  create: (b: S<"MatchIn">) => api<S<"MatchOut">>({ method: "POST", url: "/matches", data: b }),
  update: (id: string, b: S<"MatchUpdateIn">) => api<S<"MatchOut">>({ method: "PUT", url: `/matches/${id}`, data: b }),
  transition: (id: string, b: S<"TransitionIn">) => api<S<"MatchOut">>({ method: "POST", url: `/matches/${id}/transition`, data: b }),
  cancel: (id: string, reason: string) => api<S<"MatchOut">>({ method: "POST", url: `/matches/${id}/cancel`, data: { reason } }),
  complete: (id: string, b: S<"CompleteIn">) => api<S<"MatchOut">>({ method: "POST", url: `/matches/${id}/complete`, data: b }),
  invite: (id: string, b: S<"CreateInvitationsIn">) => api<S<"InvitationResultItem">[]>({ method: "POST", url: `/matches/${id}/invitations`, data: b }),
  joinRequest: (id: string, b: S<"JoinRequestIn">) => api<S<"InvitationOut">>({ method: "POST", url: `/matches/${id}/join-requests`, data: b }),
  updateSeat: (id: string, pid: string, b: S<"RosterUpdateIn">) => api<S<"RosterOut">>({ method: "PUT", url: `/matches/${id}/roster/${pid}`, data: b }),
  replace: (id: string, pid: string, b: S<"ReplaceIn">) => api<S<"InvitationResultItem">[]>({ method: "POST", url: `/matches/${id}/roster/${pid}/replace`, data: b }),
  withdraw: (id: string, reason?: string) => api<void>({ method: "POST", url: `/matches/${id}/withdraw`, data: { reason } }),
};
export const useMatches = (p: MatchListParams) =>
  useQuery({ queryKey: ["matches", "list", p], queryFn: () => apiPaged<S<"MatchOut">>({ url: "/matches", params: { ...p, page_size: 50 } }) });
export const useMatch = (id: string) => useQuery({ queryKey: ["matches", id], queryFn: () => api<S<"MatchOut">>({ url: `/matches/${id}` }) });
export const useRoster = (id: string, enabled = true) =>
  useQuery({ queryKey: ["roster", id], queryFn: () => api<S<"RosterOut">>({ url: `/matches/${id}/roster` }), enabled, retry: false });
export const useMatchInvitations = (id: string, enabled = true) =>
  useQuery({ queryKey: ["invitations", "match", id], queryFn: () => api<S<"InvitationOut">[]>({ url: `/matches/${id}/invitations` }), enabled });
export const useSuggestions = (id: string, kind: "members" | "previous", role?: string, enabled = true) =>
  useQuery({ queryKey: ["matches", id, "suggestions", kind, role], enabled,
    queryFn: () => api<S<"SuggestionOut">[]>({ url: `/matches/${id}/suggestions/${kind}`, params: { role } }) });

// ------------------------------------------------------------------ discovery
export const useFindPlayers = (body: S<"PlayerSearchIn"> | null) =>
  useQuery({ queryKey: ["discovery", "players", body], enabled: !!body, placeholderData: keepPreviousData,
    queryFn: () => apiPaged<S<"PlayerResultOut">, S<"PlayerSearchMeta">>({ method: "POST", url: "/discovery/players", data: body }) });
export const useFindTeams = (body: S<"TeamSearchIn"> | null) =>
  useQuery({ queryKey: ["discovery", "teams", body], enabled: !!body, placeholderData: keepPreviousData,
    queryFn: () => apiPaged<S<"OpportunityOut">>({ method: "POST", url: "/discovery/teams", data: body }) });
export const useVenues = (q: string, near?: { lat: number; lng: number }) =>
  useQuery({ queryKey: ["venues", q, near], queryFn: () => api<S<"VenueSearchOut">[]>({ url: "/venues", params: { q: q || undefined, ...near } }) });

// ------------------------------------------------------------------ invitations
export const invitations = {
  accept: (id: string) => api<S<"InvitationOut">>({ method: "POST", url: `/invitations/${id}/accept` }),
  reject: (id: string, reason?: string) => api<S<"InvitationOut">>({ method: "POST", url: `/invitations/${id}/reject`, data: { reason } }),
  cancel: (id: string, reason?: string) => api<S<"InvitationOut">>({ method: "POST", url: `/invitations/${id}/cancel`, data: { reason } }),
  confirm: (id: string) => api<S<"InvitationOut">>({ method: "POST", url: `/invitations/${id}/confirm` }),
};
export const useMyInvitations = (box: "received" | "sent" | "all", status?: string) =>
  useQuery({ queryKey: ["invitations", "me", box, status],
    queryFn: () => apiPaged<S<"InvitationOut">>({ url: "/invitations/me", params: { box, status, page_size: 50 } }) });
export const useManagedInvitations = (direction?: "invite" | "request", status?: string) =>
  useQuery({ queryKey: ["invitations", "managed", direction, status],
    queryFn: () => apiPaged<S<"InvitationOut">>({ url: "/invitations/managed", params: { direction, status, page_size: 50 } }) });

// ------------------------------------------------------------------ fees
export const fees = {
  addExpense: (mid: string, b: S<"ExpenseIn">) => api<S<"ExpenseOut">>({ method: "POST", url: `/matches/${mid}/expenses`, data: b }),
  removeExpense: (mid: string, eid: string) => api<void>({ method: "DELETE", url: `/matches/${mid}/expenses/${eid}` }),
  draft: (mid: string, b: S<"SettlementDraftIn">) => api<S<"SettlementOut">>({ method: "POST", url: `/matches/${mid}/settlements`, data: b }),
  publish: (sid: string) => api<S<"SettlementOut">>({ method: "POST", url: `/settlements/${sid}/publish` }),
  markPaid: (sid: string, pid: string, b: S<"MarkPaidIn">) => api<S<"PaymentRecordOut">>({ method: "POST", url: `/settlements/${sid}/payments/${pid}/mark-paid`, data: b }),
  markExempted: (sid: string, pid: string, remarks?: string) => api<S<"PaymentRecordOut">>({ method: "POST", url: `/settlements/${sid}/payments/${pid}/mark-exempted`, data: { remarks } }),
  correct: (sid: string, pid: string, b: S<"CorrectIn">) => api<S<"PaymentRecordOut">>({ method: "POST", url: `/settlements/${sid}/payments/${pid}/correct`, data: b }),
  dispute: (sid: string, pid: string, reason: string) => api<S<"PaymentRecordOut">>({ method: "POST", url: `/settlements/${sid}/payments/${pid}/dispute`, data: { reason } }),
  remind: (sid: string, pid: string) => api<S<"ShareOut">>({ method: "POST", url: `/settlements/${sid}/payments/${pid}/remind` }),
  share: (sid: string) => api<S<"ShareOut">>({ url: `/settlements/${sid}/share` }),
  postDiscussion: (rid: string, message: string) => api<S<"DiscussionOut">>({ method: "POST", url: `/payments/${rid}/discussion`, data: { message } }),
};
export const useExpenses = (mid: string) => useQuery({ queryKey: ["settlements", mid, "expenses"], queryFn: () => api<S<"ExpenseOut">[]>({ url: `/matches/${mid}/expenses` }) });
export const useSettlements = (mid: string) => useQuery({ queryKey: ["settlements", mid], queryFn: () => api<S<"SettlementOut">[]>({ url: `/matches/${mid}/settlements` }) });
export const usePaymentsDashboard = (sid: string | undefined) =>
  useQuery({ queryKey: ["payments", sid], enabled: !!sid, queryFn: () => api<S<"CaptainDashboardOut">>({ url: `/settlements/${sid}/payments` }) });
export const useMyPayments = (status?: string) =>
  useQuery({ queryKey: ["payments", "me", status], queryFn: () => api<S<"PlayerDashboardOut">>({ url: "/settlements/me", params: { status } }) });
export const useDiscussion = (rid: string | null) =>
  useQuery({ queryKey: ["payments", "discussion", rid], enabled: !!rid, queryFn: () => api<S<"DiscussionOut">[]>({ url: `/payments/${rid}/discussion` }) });

// ------------------------------------------------------------------ ratings, reports, notifications, admin
export const ratings = {
  rate: (mid: string, b: S<"RatingIn">) => api<S<"RatingOut">>({ method: "POST", url: `/matches/${mid}/ratings`, data: b }),
};
export const useRateable = (mid: string, enabled = true) =>
  useQuery({ queryKey: ["ratings", mid, "pending"], enabled, retry: false, queryFn: () => api<S<"RateableOut">[]>({ url: `/matches/${mid}/ratings/pending` }) });
export const useReputation = (uid: string, type: "player" | "captain") =>
  useQuery({ queryKey: ["ratings", uid, type], queryFn: () => api<S<"ReputationOut">>({ url: `/users/${uid}/ratings`, params: { type } }) });

export const reports = {
  create: (b: S<"ReportIn">) => api<S<"ReportOut">>({ method: "POST", url: "/reports", data: b }),
};
export const useMyReports = () => useQuery({ queryKey: ["reports", "me"], queryFn: () => api<S<"ReportOut">[]>({ url: "/reports/me" }) });

export const notifications = {
  read: (id: string) => api<void>({ method: "POST", url: `/notifications/${id}/read` }),
  readAll: () => api<void>({ method: "POST", url: "/notifications/read-all" }),
};
export const useNotifications = () =>
  useQuery({ queryKey: ["notifications"], queryFn: () => apiPaged<S<"NotificationOut">, S<"NotificationMeta">>({ url: "/notifications", params: { page_size: 50 } }) });

export const admin = {
  updateReport: (id: string, b: S<"ReportUpdateIn">) => api<S<"AdminReportOut">>({ method: "PUT", url: `/admin/reports/${id}`, data: b }),
  moderateRating: (id: string, b: S<"ModerateRatingIn">) => api<S<"RatingOut">>({ method: "PUT", url: `/admin/ratings/${id}`, data: b }),
};
export const useAdminStats = () => useQuery({ queryKey: ["admin", "stats"], queryFn: () => api<S<"AdminStats">>({ url: "/admin/stats" }) });
export const useAdminReports = (status?: string) =>
  useQuery({ queryKey: ["admin", "reports", status], queryFn: () => apiPaged<S<"AdminReportOut">>({ url: "/admin/reports", params: { status, page_size: 50 } }) });

export type { Paged };

// ------------------------------------------------------------------ CricHeroes
export const cricheroes = {
  link: (teamId: string, url: string) =>
    api<S<"CricHeroesProfileOut">>({ method: "PUT", url: `/teams/${teamId}/cricheroes/link`, data: { url } }),
  import: (teamId: string, b: S<"CricHeroesImportIn">) =>
    api<S<"CricHeroesProfileOut">>({ method: "POST", url: `/teams/${teamId}/cricheroes/import`, data: b }),
  sync: (teamId: string) => api<S<"CricHeroesProfileOut">>({ method: "POST", url: `/teams/${teamId}/cricheroes/sync` }),
  remove: (teamId: string) => api<void>({ method: "DELETE", url: `/teams/${teamId}/cricheroes` }),
};
export const useCricHeroes = (teamId: string) =>
  useQuery({ queryKey: ["teams", teamId, "cricheroes"], queryFn: () => api<S<"CricHeroesProfileOut">>({ url: `/teams/${teamId}/cricheroes` }) });
