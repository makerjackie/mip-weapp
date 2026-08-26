export function rankingTeamRoute(subjectType: unknown, teamId: unknown) {
  const resolvedTeamId = typeof teamId === 'string' ? teamId.trim() : ''
  return subjectType === 'TEAM' && resolvedTeamId
    ? `/packages/member/mip-game/team/index?teamId=${encodeURIComponent(resolvedTeamId)}`
    : ''
}
