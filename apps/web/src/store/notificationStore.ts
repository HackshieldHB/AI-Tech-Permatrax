import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface PtNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: PtNotification[];
  unreadCount: number;
  unreadPRCount: number;
  unreadCashOpCount: number; // NEW: cash operation inbox badge
  addNotification: (n: PtNotification) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  incrementUnreadPR: () => void;
  resetUnreadPR: () => void;
  incrementUnreadCashOp: () => void; // NEW: increment cash-op badge
  resetUnreadCashOp: () => void; // NEW: clear cash-op badge
}

const MAX = 50;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  unreadPRCount: 0,
  unreadCashOpCount: 0, // NEW: cash-op badge initial state

  addNotification: (n) =>
    set((state) => {
      const withType: PtNotification = {
        ...n,
        type: n.type ?? 'info',
      };
      const next = [withType, ...state.notifications].slice(0, MAX);
      return {
        notifications: next,
        unreadCount: state.unreadCount + (withType.isRead ? 0 : 1),
      };
    }),

  // MODIFIED: only decrement unread when marking a previously unread item
  markRead: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      const wasUnread = Boolean(target && !target.isRead);
      return {
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    })),

  incrementUnreadPR: () => set((state) => ({ unreadPRCount: state.unreadPRCount + 1 })),

  resetUnreadPR: () => set({ unreadPRCount: 0 }),

  incrementUnreadCashOp: () => set((state) => ({ unreadCashOpCount: state.unreadCashOpCount + 1 })), // NEW

  resetUnreadCashOp: () => set({ unreadCashOpCount: 0 }), // NEW
}));
