import { useState, useEffect } from 'react';
import { DashboardStatePoller, type DashboardState } from '../services/dashboard-poller';

// In a real app with strict DI this instance might live in Context
// For this single-dashboard demo, a singleton works perfectly.
const globalPoller = new DashboardStatePoller(5000);
let isStarted = false;

export function useDashboardData() {
    const [state, setState] = useState<DashboardState>(() => globalPoller.getState());

    useEffect(() => {
        if (!isStarted) {
            globalPoller.start();
            isStarted = true;
        }

        const unsubscribe = globalPoller.subscribe(setState);

        return () => {
            unsubscribe();
        };
    }, []);

    return {
        ...state,
        refresh: () => globalPoller.fetchAll(),
    };
}
