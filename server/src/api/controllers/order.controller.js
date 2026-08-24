import crypto from 'node:crypto';
import { z } from 'zod';
import { FoodItem, Order, Restaurant } from '../../models/index.js';
import { estimateForRestaurant } from '../../services/crowd/crowdEngine.js';
import { reinforcePositive } from '../../services/personalization.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serializeOrder } from '../serializers.js';

const DELIVERY_FEE = 29;
const FREE_DELIVERY_OVER = 499;
const TAX_RATE = 0.05;

export const createOrderSchema = z.object({
  items: z
    .array(z.object({ foodId: z.string(), quantity: z.number().int().min(1).max(20) }))
    .min(1, 'Your cart is empty'),
  fulfilment: z.enum(['delivery', 'pickup']).default('delivery'),
  address: z
    .object({
      label: z.string().max(40).optional(),
      line1: z.string().min(4, 'Address line is required').max(160),
      line2: z.string().max(160).optional(),
      city: z.string().max(60).optional(),
      pincode: z.string().max(10).optional(),
    })
    .optional(),
  paymentMethod: z.enum(['demo_upi', 'demo_card', 'cash_on_delivery']).default('demo_upi'),
  notes: z.string().max(300).optional(),
  recommendationId: z.string().optional(),
});

/**
 * Demo checkout. There is no payment gateway and no card data is collected —
 * `payment.isSimulated` is always true and the UI says so at checkout.
 */
export const create = asyncHandler(async (req, res) => {
  const { items, fulfilment, address, paymentMethod, notes, recommendationId } = req.body;

  if (fulfilment === 'delivery' && !address?.line1) {
    throw ApiError.badRequest('A delivery address is required', { address: 'Enter where we should deliver' });
  }

  const foodIds = items.map((i) => i.foodId);
  const foods = await FoodItem.find({ _id: { $in: foodIds }, isAvailable: true }).lean();

  if (foods.length !== new Set(foodIds).size) {
    throw ApiError.badRequest('Some items are no longer available. Please refresh your cart.');
  }

  const restaurantIds = new Set(foods.map((f) => String(f.restaurant)));
  if (restaurantIds.size > 1) {
    throw ApiError.badRequest('All items in one order must come from the same restaurant.');
  }

  const restaurant = await Restaurant.findById([...restaurantIds][0]).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  if (fulfilment === 'delivery' && !restaurant.deliveryAvailable) {
    throw ApiError.badRequest(`${restaurant.name} does not deliver. Try pickup instead.`);
  }

  const foodMap = new Map(foods.map((f) => [String(f._id), f]));
  const orderItems = items.map(({ foodId, quantity }) => {
    const food = foodMap.get(String(foodId));
    return {
      food: food._id,
      name: food.name,
      emoji: food.emoji,
      unitPrice: food.price,
      quantity,
      lineTotal: food.price * quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const deliveryFee = fulfilment === 'delivery' && subtotal < FREE_DELIVERY_OVER ? DELIVERY_FEE : 0;
  const taxes = Math.round(subtotal * TAX_RATE);
  const total = subtotal + deliveryFee + taxes;

  const crowd = await estimateForRestaurant(restaurant, {});
  const slowestPrep = Math.max(...orderItems.map((i) => foodMap.get(String(i.food)).prepTimeMinutes ?? 15));
  const crowdDelay = Math.round(((crowd?.score ?? 30) / 100) ** 1.6 * 18);
  const etaMinutes =
    fulfilment === 'delivery'
      ? (restaurant.deliveryBaseMinutes ?? 20) + slowestPrep + crowdDelay
      : slowestPrep + crowdDelay;

  const order = await Order.create({
    orderNumber: `FA${Date.now().toString(36).toUpperCase()}${crypto.randomInt(100, 999)}`,
    user: req.userId,
    restaurant: restaurant._id,
    restaurantName: restaurant.name,
    items: orderItems,
    fulfilment,
    deliveryAddress: fulfilment === 'delivery' ? address : undefined,
    pricing: { subtotal, deliveryFee, taxes, total },
    payment: {
      method: paymentMethod,
      status: paymentMethod === 'cash_on_delivery' ? 'pending' : 'paid',
      reference: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      isSimulated: true,
    },
    status: 'placed',
    statusHistory: [{ status: 'placed', at: new Date(), note: 'Order received' }],
    etaMinutes,
    notes,
    placedFromRecommendation: recommendationId || undefined,
  });

  // Ordering is the strongest positive signal we get.
  await reinforcePositive({ userId: req.userId, foods, restaurantId: restaurant._id, strength: 0.1 })
    .catch((error) => console.warn('[orders] preference update skipped:', error.message));

  res.status(201).json({
    order: serializeOrder(order),
    payment: {
      simulated: true,
      message: 'This is a demo checkout. No real payment was processed and no card details were collected.',
    },
  });
});

export const list = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('restaurant', 'name emoji slug rating')
    .lean();

  const advanced = await Promise.all(orders.map((order) => advanceStatus(order)));
  res.json({ orders: advanced.map(serializeOrder) });
});

export const detail = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.userId })
    .populate('restaurant', 'name emoji slug rating address location')
    .lean();
  if (!order) throw ApiError.notFound('Order not found');

  res.json({ order: serializeOrder(await advanceStatus(order)) });
});

export const cancel = asyncHandler(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.userId });
  if (!order) throw ApiError.notFound('Order not found');
  if (['delivered', 'cancelled'].includes(order.status)) {
    throw ApiError.badRequest(`This order is already ${order.status}.`);
  }
  if (['out_for_delivery', 'ready_for_pickup'].includes(order.status)) {
    throw ApiError.badRequest('This order has already left the kitchen and can no longer be cancelled.');
  }

  order.status = 'cancelled';
  order.statusHistory.push({ status: 'cancelled', at: new Date(), note: 'Cancelled by customer' });
  if (order.payment.status === 'paid') order.payment.status = 'refunded';
  await order.save();

  res.json({ order: serializeOrder(order) });
});

/**
 * Demo order lifecycle. With no kitchen behind the app, status is derived from
 * elapsed time when the order is read, then persisted so history stays honest.
 */
async function advanceStatus(orderDoc) {
  const order = orderDoc;
  if (['delivered', 'cancelled'].includes(order.status)) return order;

  const minutesElapsed = (Date.now() - new Date(order.createdAt)) / 60000;
  const eta = order.etaMinutes ?? 30;

  const timeline = order.fulfilment === 'delivery'
    ? [
      { at: 1, status: 'confirmed', note: 'Restaurant accepted the order' },
      { at: 3, status: 'preparing', note: 'Kitchen started cooking' },
      { at: eta * 0.65, status: 'out_for_delivery', note: 'On the way to you' },
      { at: eta, status: 'delivered', note: 'Delivered' },
    ]
    : [
      { at: 1, status: 'confirmed', note: 'Restaurant accepted the order' },
      { at: 3, status: 'preparing', note: 'Kitchen started cooking' },
      { at: eta, status: 'ready_for_pickup', note: 'Ready for pickup' },
    ];

  const reached = timeline.filter((step) => minutesElapsed >= step.at);
  const target = reached[reached.length - 1];
  if (!target || target.status === order.status) return order;

  await Order.updateOne(
    { _id: order._id },
    {
      $set: { status: target.status },
      $push: { statusHistory: { status: target.status, at: new Date(), note: target.note } },
    }
  );

  order.status = target.status;
  order.statusHistory = [...(order.statusHistory ?? []), { status: target.status, at: new Date(), note: target.note }];
  return order;
}
