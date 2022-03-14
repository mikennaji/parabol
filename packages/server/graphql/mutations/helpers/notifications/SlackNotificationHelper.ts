import formatTime from 'parabol-client/utils/date/formatTime'
import formatWeekday from 'parabol-client/utils/date/formatWeekday'
import makeAppURL from 'parabol-client/utils/makeAppURL'
import findStageById from 'parabol-client/utils/meetings/findStageById'
import {phaseLabelLookup} from 'parabol-client/utils/meetings/lookups'
import appOrigin from '../../../../appOrigin'
import getRethink from '../../../../database/rethinkDriver'
import Meeting from '../../../../database/types/Meeting'
import {SlackNotificationAuth} from '../../../../dataloader/integrationAuthLoaders'
import {toEpochSeconds} from '../../../../utils/epochTime'
import segmentIo from '../../../../utils/segmentIo'
import sendToSentry from '../../../../utils/sendToSentry'
import SlackServerManager from '../../../../utils/SlackServerManager'
import getSummaryText from './getSummaryText'
import {makeButtons, makeSection, makeSections} from './makeSlackBlocks'
import {NotificationIntegrationHelper, NotifyResponse} from './NotificationIntegrationHelper'
import {SlackNotificationEvent} from '../../../../database/types/SlackNotification'

const notifySlack = async (
  notificationChannel: SlackNotificationAuth,
  event: SlackNotificationEvent,
  teamId: string,
  slackMessage: string | Array<{type: string}>,
  notificationText?: string
): Promise<NotifyResponse> => {
  const {channelId, auth} = notificationChannel
  const {botAccessToken, userId} = auth
  const manager = new SlackServerManager(botAccessToken!)
  const res = await manager.postMessage(channelId!, slackMessage, notificationText)
  segmentIo.track({
    userId,
    event: 'Slack notification sent',
    properties: {
      teamId,
      notificationEvent: event
    }
  })
  if ('error' in res) {
    const {error} = res
    if (error === 'channel_not_found') {
      const r = await getRethink()
      await r
        .table('SlackNotification')
        .getAll(teamId, {index: 'teamId'})
        .filter({channelId})
        .update({
          channelId: null
        })
        .run()
      return {
        error: new Error('channel_not_found')
      }
    } else if (error === 'not_in_channel' || error === 'invalid_auth') {
      sendToSentry(
        new Error(`Slack Channel Notification Error: ${teamId}, ${channelId}, ${auth.id}`)
      )
      return {
        error: new Error(error)
      }
    }
  }
  return 'success'
}

const makeEndMeetingButtons = (meeting: Meeting) => {
  const {id: meetingId} = meeting
  const searchParams = {
    utm_source: 'slack summary',
    utm_medium: 'product',
    utm_campaign: 'after-meeting'
  }
  const options = {searchParams}
  const summaryUrl = makeAppURL(appOrigin, `new-summary/${meetingId}`, options)
  const makeDiscussionButton = (meetingUrl: string) => ({
    text: 'See discussion',
    url: meetingUrl
  })
  const summaryButton = {
    text: 'Review summary',
    url: summaryUrl
  } as const
  switch (meeting.meetingType) {
    case 'retrospective':
      const retroUrl = makeAppURL(appOrigin, `meet/${meetingId}/discuss/1`)
      return makeButtons([makeDiscussionButton(retroUrl), summaryButton])
    case 'action':
      const checkInUrl = makeAppURL(appOrigin, `meet/${meetingId}/checkin/1`)
      return makeButtons([makeDiscussionButton(checkInUrl), summaryButton])
    case 'poker':
      const pokerUrl = makeAppURL(appOrigin, `meet/${meetingId}/estimate/1`)
      const estimateButton = {
        text: 'See estimates',
        url: pokerUrl
      }
      return makeButtons([estimateButton, summaryButton])
    default:
      throw new Error('Invalid meeting type')
  }
}

export const SlackNotificationHelper: NotificationIntegrationHelper<SlackNotificationAuth> = (
  notificationChannel
) => ({
  async startMeeting(meeting, team) {
    const searchParams = {
      utm_source: 'slack meeting start',
      utm_medium: 'product',
      utm_campaign: 'invitations'
    }
    const options = {searchParams}
    const meetingUrl = makeAppURL(appOrigin, `meet/${meeting.id}`, options)
    const button = {text: 'Join meeting', url: meetingUrl, type: 'primary'} as const
    const title = 'Meeting started :wave: '
    const blocks = [
      makeSection(title),
      makeSections([`*Team:*\n${team.name}`, `*Meeting:*\n${meeting.name}`]),
      makeSection(`*Link:*\n<${meetingUrl}|https:/prbl.in/${meeting.id}>`),
      makeButtons([button])
    ]
    return notifySlack(notificationChannel, 'meetingStart', team.id, blocks, title)
  },

  async endMeeting(meeting, team) {
    const summaryText = getSummaryText(meeting)
    const {name: teamName} = team
    const {name: meetingName} = meeting
    const title = 'Meeting completed :tada:'
    const blocks = [
      makeSection(title),
      makeSections([`*Team:*\n${teamName}`, `*Meeting:*\n${meetingName}`]),
      makeSection(summaryText),
      makeEndMeetingButtons(meeting)
    ]
    return notifySlack(notificationChannel, 'meetingEnd', team.id, blocks, title)
  },

  async startTimeLimit(scheduledEndTime, meeting, team) {
    const {name: meetingName, phases, facilitatorStageId} = meeting
    const {name: teamName} = team
    const stageRes = findStageById(phases, facilitatorStageId)
    const {stage} = stageRes!
    const maybeMeetingShortLink = makeAppURL(process.env.INVITATION_SHORTLINK!, `${meeting.id}`)
    const meetingUrl = makeAppURL(appOrigin, `meet/${meeting.id}`)
    const {phaseType} = stage
    const phaseLabel = phaseLabelLookup[phaseType]

    const fallbackDate = formatWeekday(scheduledEndTime)
    const fallbackTime = formatTime(scheduledEndTime)
    const fallbackZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Eastern Time'
    const fallback = `${fallbackDate} at ${fallbackTime} (${fallbackZone})`
    const constraint = `You have until *<!date^${toEpochSeconds(
      scheduledEndTime
    )}^{date_short_pretty} at {time}|${fallback}>* to complete it.`
    const button = {text: 'Open meeting', url: meetingUrl, type: 'primary'} as const
    const title = `The *${phaseLabel} Phase* has begun :hourglass_flowing_sand:`
    const blocks = [
      makeSection(title),
      makeSections([`*Team:*\n${teamName}`, `*Meeting:*\n${meetingName}`]),
      makeSection(constraint),
      makeSection(`*Link:*\n<${meetingUrl}|${maybeMeetingShortLink}>`),
      makeButtons([button])
    ]
    return notifySlack(
      notificationChannel,
      'MEETING_STAGE_TIME_LIMIT_START',
      team.id,
      blocks,
      title
    )
  },

  async endTimeLimit(meeting, team) {
    const meetingUrl = makeAppURL(appOrigin, `meet/${meeting.id}`)
    // TODO now is a good time to make the message nice with the `meetingName`
    const slackText = `Time’s up! Advance your meeting to the next phase: ${meetingUrl}`
    return notifySlack(notificationChannel, 'MEETING_STAGE_TIME_LIMIT_END', team.id, slackText)
  }
})
