export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'staff';
}

export interface Product {
  id: number;
  name: string;
  barcode: string;
  cost_price: number;
  selling_price: number;
  mrp: number;
  total_qty: number;
  sold_qty: number;
  reserved_qty: number;
  category: string;
  image_url?: string;
  tax_rate: number;
  sku?: string;
  size_weight?: number;
  unit?: string;
  description?: string;
  product_description?: string;
  active?: number;
}

export interface Bill {
  id: number;
  bill_date: string;
  bill_time: string;
  total_amount: number;
  customer_name?: string;
  customer_phone?: string;
  discount_amount?: number;
  payment_method?: string;
  shift_id?: number | null;
}

export interface Sale {
  id: number;
  bill_id: number;
  product_id: number;
  qty_sold: number;
  profit_made: number;
  sale_date: string;
  unit_price: number;
}

export interface Shift {
  id: number;
  user_id: number;
  opening_time: string;
  closing_time: string | null;
  opening_cash: number;
  expected_closing_cash: number | null;
  actual_closing_cash: number | null;
  status: 'open' | 'closed';
}

export interface CartItem {
  id: number;
  name: string;
  qty: number;
  price: number;
  mrp: number;
  cost: number;
  total: number;
  tax_rate: number;
}

export interface Customer {
  id: number;
  phone: string;
  name: string;
  email: string;
  password_hash?: string;
  account_status: string;
  delivery_address: string;
  landmark: string;
  pincode: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerAddress {
  id: number;
  customer_id: number;
  label: string;
  recipient_name: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface OnlineOrder {
  id: number;
  order_number: string;
  customer_id: number;
  subtotal: number;
  delivery_charge: number;
  discount: number;
  total_amount: number;
  payment_mode: 'COD' | 'UPI_QR';
  delivery_type: 'DELIVERY' | 'STORE_PICKUP';
  status: 'NEW' | 'CONFIRMED' | 'PACKING' | 'READY' | 'DISPATCHED' | 'COMPLETED' | 'CANCELLED';
  notes: string;
  whatsapp_message_sent: number;
  traceparent?: string;
  created_at: string;
  updated_at: string;
}

export interface OnlineOrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
}

export interface OrderStatusLog {
  id: number;
  order_id: number;
  previous_status: string | null;
  new_status: string;
  changed_by: string;
  timestamp: string;
}

export interface OnlineOrderFull extends OnlineOrder {
  customer: Customer;
  items: OnlineOrderItem[];
}

export type MovementType = 'PURCHASE' | 'POS_SALE' | 'ONLINE_SALE' | 'RETURN' | 'ADJUSTMENT' | 'DAMAGED' | 'RESERVATION' | 'RESERVATION_RELEASE';

export interface StockMovement {
  id: number;
  product_variant_id: number;
  quantity_delta: number;
  movement_type: MovementType;
  reference_type?: string;
  reference_id?: string;
  actor: string;
  notes?: string;
  timestamp: string;
}
