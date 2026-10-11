export const OrderTemplates = {
  ORDER_CREATED: 'order_created_alert',
  ORDER_CONFIRMED: 'order_confirmed_alert',
  ORDER_PACKING: 'order_packing_alert',
  ORDER_READY: 'order_ready_pickup_alert',
  ORDER_DISPATCHED: 'order_dispatched_alert',
  ORDER_COMPLETED: 'order_completed_alert',
  ORDER_CANCELLED: 'order_cancelled_alert'
};

export const buildTemplateComponents = (status: string, orderDetails: any): any[] => {
  // In a real application, you would map parameters based on Facebook template definitions.
  // For example, if 'order_created_alert' takes {{1}} as Name and {{2}} as Order ID.
  
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: orderDetails.customerName || 'Customer' },
        { type: 'text', text: orderDetails.orderNumber || 'Unknown' }
      ]
    }
  ];
};
