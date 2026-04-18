import { Router } from 'express';
import { whatsappRouter } from './whatsapp/routes';
import { leadsRouter } from './leads/routes';
import { ordersRouter } from './orders/routes';
import { paymentsRouter } from './payments/routes';
import { productsRouter } from './products/routes';
import { followUpsRouter } from './followups/routes';
import { escalationsRouter } from './escalations/routes';
import { analyticsRouter } from './analytics/routes';
import { customersRouter } from './customers/routes';
import { conversationsRouter } from './conversations/routes';
import { messagesRouter } from './messages/routes';

const router = Router();

router.use('/whatsapp', whatsappRouter);
router.use('/leads', leadsRouter);
router.use('/orders', ordersRouter);
router.use('/payments', paymentsRouter);
router.use('/products', productsRouter);
router.use('/followups', followUpsRouter);
router.use('/escalations', escalationsRouter);
router.use('/analytics', analyticsRouter);
router.use('/customers', customersRouter);
router.use('/conversations', conversationsRouter);
router.use('/messages', messagesRouter);

router.get('/', (req, res) => {
  res.json({ message: 'The Mango Lover Shop AI API' });
});

export default router;
