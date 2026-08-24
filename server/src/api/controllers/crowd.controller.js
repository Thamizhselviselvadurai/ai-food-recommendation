import crypto from 'node:crypto';
import { z } from 'zod';
import { CheckIn, CrowdReport, Restaurant } from '../../models/index.js';
import { CROWD_REPORT_LEVELS } from '../../domain/constants.js';
import { estimateForRestaurant } from '../../services/crowd/crowdEngine.js';
import { recomputeSnapshots } from '../../services/crowd/aggregate.js';
import { haversineKm } from '../../utils/geo.js';
import { nowParts } from '../../utils/time.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const CHECKIN_TTL_MINUTES = 150;
const MAX_CHECKIN_DISTANCE_KM = 1.5;

export const checkInSchema = z.object({
  partySize: z.number().int().min(1).max(20).optional(),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
});

export const reportSchema = z.object({
  level: z.enum(CROWD_REPORT_LEVELS),
  observedWaitMinutes: z.number().int().min(0).max(240).nullable().optional(),
  note: z.string().max(200).optional(),
});

/**
 * Anonymous, non-reversible actor key. Used only to stop one device flooding a
 * venue with reports — it is never stored alongside anything identifying and
 * never returned by any read endpoint.
 */
function anonymousKey(req) {
  const material = `${req.userId ?? ''}|${req.ip}|${req.headers['user-agent'] ?? ''}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** "I'm currently at this restaurant." */
export const checkIn = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  // If the device shared a location, sanity-check that they are actually there.
  const { location } = req.body;
  if (location) {
    const [lng, lat] = restaurant.location?.coordinates ?? [];
    const distance = haversineKm(location, { lat, lng });
    if (distance != null && distance > MAX_CHECKIN_DISTANCE_KM) {
      throw ApiError.badRequest(
        `You look about ${distance.toFixed(1)} km away. Check in when you get there so the crowd estimate stays accurate.`
      );
    }
  }

  const key = anonymousKey(req);
  const recent = await CheckIn.findOne({
    restaurant: restaurant._id,
    anonymousKey: key,
    createdAt: { $gte: new Date(Date.now() - 45 * 60000) },
  });
  if (recent) throw ApiError.conflict('You are already checked in here.');

  const { dayOfWeek, hour } = nowParts();
  await CheckIn.create({
    restaurant: restaurant._id,
    user: req.userId ?? undefined,
    anonymousKey: key,
    partySize: req.body.partySize ?? 1,
    dayOfWeek,
    hour,
    expiresAt: new Date(Date.now() + CHECKIN_TTL_MINUTES * 60000),
  });

  const crowd = await estimateForRestaurant(restaurant, {});
  res.status(201).json({
    message: 'Thanks — this helps everyone see how busy it is right now.',
    crowd,
    privacyNote: 'Your check-in is stored anonymously and expires automatically.',
  });
});

/** Post-visit crowd feedback: empty / low / moderate / crowded / very crowded. */
export const report = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  const { dayOfWeek, hour } = nowParts();
  await CrowdReport.create({
    restaurant: restaurant._id,
    user: req.userId ?? undefined,
    anonymousKey: anonymousKey(req),
    level: req.body.level,
    observedWaitMinutes: req.body.observedWaitMinutes ?? undefined,
    note: req.body.note,
    dayOfWeek,
    hour,
  });

  // Fold the new report into the historical pattern immediately.
  await recomputeSnapshots(restaurant._id);

  const crowd = await estimateForRestaurant(restaurant, {});
  res.status(201).json({ message: 'Thanks for the report.', crowd });
});

export const status = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findById(req.params.id).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  const crowd = await estimateForRestaurant(restaurant, {});
  res.json({ restaurantId: String(restaurant._id), crowd });
});

export const methodology = (req, res) => {
  res.json({
    title: 'How we estimate how busy a place is',
    summary:
      'We build our own estimate from signals this app collects. We do not have, use, or claim access to any ' +
      'external map provider’s live popularity data.',
    signals: [
      { key: 'baseline', label: 'Venue baseline', description: 'Modelled from the venue’s service profile, opening hours and past activity.' },
      { key: 'historical', label: 'Historical pattern', description: 'Rolled-up check-ins and crowd reports for this same weekday and hour.' },
      { key: 'liveCheckIns', label: 'Live check-ins', description: 'Anonymous "I’m here now" check-ins in the last 75 minutes, compared against seating capacity.' },
      { key: 'recentReports', label: 'Recent visitor reports', description: 'Crowd reports submitted in the last two hours, weighted towards the newest.' },
      { key: 'context', label: 'Context', description: 'Small adjustments for weekend evenings and weather.' },
    ],
    limitations: [
      'It is an estimate, not a measurement, and can be wrong.',
      'Confidence is lower for venues with few reports — the UI shows this.',
      'Check-ins expire automatically and are stored without identifying information.',
    ],
  });
};
