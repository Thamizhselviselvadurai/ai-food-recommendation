import { createContext, useCallback, useContext, useMemo } from 'react';
import { usePersistentState } from '../lib/hooks.js';

const CartContext = createContext(null);

const DELIVERY_FEE = 29;
const FREE_DELIVERY_OVER = 499;
const TAX_RATE = 0.05;

/**
 * One cart, one restaurant — the API enforces the same rule, so switching
 * restaurants asks before replacing the cart rather than failing at checkout.
 */
export function CartProvider({ children }) {
  const [cart, setCart] = usePersistentState('foodai.cart', { restaurant: null, items: [] });

  const add = useCallback(
    (food, restaurant, quantity = 1) => {
      let replaced = false;

      setCart((current) => {
        const differentRestaurant = current.restaurant && current.restaurant.id !== restaurant.id;
        if (differentRestaurant && current.items.length) {
          replaced = true;
          return { restaurant, items: [{ food, quantity }] };
        }

        const existing = current.items.find((item) => item.food.id === food.id);
        const items = existing
          ? current.items.map((item) =>
            item.food.id === food.id ? { ...item, quantity: Math.min(20, item.quantity + quantity) } : item)
          : [...current.items, { food, quantity }];

        return { restaurant, items };
      });

      return { replaced };
    },
    [setCart]
  );

  const setQuantity = useCallback(
    (foodId, quantity) => {
      setCart((current) => {
        const items = current.items
          .map((item) => (item.food.id === foodId ? { ...item, quantity } : item))
          .filter((item) => item.quantity > 0);
        return { restaurant: items.length ? current.restaurant : null, items };
      });
    },
    [setCart]
  );

  const remove = useCallback((foodId) => setQuantity(foodId, 0), [setQuantity]);
  const clear = useCallback(() => setCart({ restaurant: null, items: [] }), [setCart]);

  const totals = useMemo(() => {
    const subtotal = cart.items.reduce((sum, item) => sum + item.food.price * item.quantity, 0);
    const deliveryFee = subtotal > 0 && subtotal < FREE_DELIVERY_OVER ? DELIVERY_FEE : 0;
    const taxes = Math.round(subtotal * TAX_RATE);
    return {
      subtotal,
      deliveryFee,
      taxes,
      total: subtotal + deliveryFee + taxes,
      count: cart.items.reduce((sum, item) => sum + item.quantity, 0),
      freeDeliveryGap: Math.max(0, FREE_DELIVERY_OVER - subtotal),
    };
  }, [cart.items]);

  const value = useMemo(
    () => ({ ...cart, add, setQuantity, remove, clear, totals }),
    [cart, add, setQuantity, remove, clear, totals]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside <CartProvider>');
  return context;
};
