import {GQLContext} from './../../graphql'
import {GraphQLInt, GraphQLNonNull} from 'graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import {ValueOf} from '../../../../client/types/generics'
import getRethink from '../../../database/rethinkDriver'
import NotificationMeetingStageTimeLimitEnd from '../../../database/types/NotificationMeetingStageTimeLimitEnd'
import ScheduledJobMeetingStageTimeLimit from '../../../database/types/ScheduledJobMetingStageTimeLimit'
import {requireSU} from '../../../utils/authorization'
import publish from '../../../utils/publish'
import {DataLoaderWorker} from '../../graphql'
import {NotificationHelper} from '../../mutations/helpers/notifications/NotificationHelper'

const processMeetingStageTimeLimits = async (
  job: ScheduledJobMeetingStageTimeLimit,
  {dataLoader}: {dataLoader: DataLoaderWorker}
) => {
  // get the meeting
  // get the facilitator
  // see if the facilitator has turned on slack notifications for the meeting
  // detect integrated services
  // if slack, send slack
  // if mattermost, send mattermost
  // if no integrated notification services, send an in-app notification
  const {meetingId} = job
  const meeting = await dataLoader.get('newMeetings').load(meetingId)
  const {teamId, facilitatorUserId} = meeting
  NotificationHelper.endTimeLimit(dataLoader, meetingId, teamId)

  const notification = new NotificationMeetingStageTimeLimitEnd({
    meetingId,
    userId: facilitatorUserId
  })
  const r = await getRethink()
  await r.table('Notification').insert(notification).run()
  publish(SubscriptionChannel.NOTIFICATION, facilitatorUserId, 'MeetingStageTimeLimitPayload', {
    notification
  })
}

const jobProcessors = {
  MEETING_STAGE_TIME_LIMIT_END: processMeetingStageTimeLimits
}

export type ScheduledJobUnion = Parameters<ValueOf<typeof jobProcessors>>[0]

const processJob = async (job: ScheduledJobUnion, {dataLoader}: {dataLoader: DataLoaderWorker}) => {
  const r = await getRethink()
  const res = await r.table('ScheduledJob').get(job.id).delete().run()
  // prevent duplicates. after this point, we assume the job finishes to completion (ignores server crashes, etc.)
  if (res.deleted !== 1) return
  const processor = jobProcessors[job.type]
  processor(job, {dataLoader}).catch(console.log)
}

const runScheduledJobs = {
  type: GraphQLInt,
  description: 'schedule upcoming jobs to be run',
  args: {
    seconds: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'Queue up all jobs that are scheduled to run within this many seconds'
    }
    // type: {
    //   type: GraphQLString,
    //   description: 'filter jobs by their type'
    // }
  },
  resolve: async (
    _source: unknown,
    {seconds}: {seconds: number},
    {authToken, dataLoader}: GQLContext
  ) => {
    const r = await getRethink()
    const now = new Date()
    // AUTH
    requireSU(authToken)

    // RESOLUTION
    const before = new Date(now.getTime() + seconds * 1000)
    const upcomingJobs = (await r
      .table('ScheduledJob')
      .between(r.minval, before, {index: 'runAt'})
      .run()) as ScheduledJobUnion[]

    upcomingJobs.forEach((job) => {
      const {runAt} = job
      const timeout = Math.max(0, runAt.getTime() - now.getTime())
      setTimeout(() => {
        processJob(job, {dataLoader}).catch(console.log)
      }, timeout)
    })

    return upcomingJobs.length
  }
}

export default runScheduledJobs
