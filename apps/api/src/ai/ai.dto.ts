import { z } from 'zod';

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
});
export type ChatRequestDto = z.infer<typeof ChatRequestSchema>;

export const FeedbackRequestSchema = z.object({
  messageId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});
export type FeedbackRequestDto = z.infer<typeof FeedbackRequestSchema>;
