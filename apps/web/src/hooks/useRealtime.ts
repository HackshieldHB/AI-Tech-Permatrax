'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { API_HOST } from '../lib/api'; // FIX: centralised API host (no hardcoded localhost fallback)

/**
 * Singleton-compliant React Hook binding bidirectional telemetry
 * bypassing normal long-polling HTTP REST.
 */
export function useRealtime() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // 1. Establish native duplex socket to NestJS via centralised API_HOST
    socketRef.current = io(API_HOST);

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('PermaTrax Telemetry connected. ID:', socket.id); // FIX: branding update
    });

    // 2. Consume events pushed from backend natively via Sonner Toasts
    socket.on('sla_alert', (payload: any) => {
      if (payload.escalationType === 'BREACH') {
         toast.error(`SLA Breach Critical: Project Request ${payload.requestId}`);
      } else {
         toast.warning(`SLA Warning Matrix limit approaching for ${payload.requestId}`);
      }
    });

    socket.on('request_approved', (payload: any) => {
      toast.success(`Workflow Checkmate: Phase Approved by ${payload.approver}`);
    });

    // 3. Prevent socket ghost accumulation on re-renders
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);
}
