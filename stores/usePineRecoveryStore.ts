"use client";
import { create } from "zustand";
import type { PineRecoveryProgress } from "@/types/pineAlerts";
interface State { progress: Record<string, PineRecoveryProgress>; update: (value: PineRecoveryProgress) => void; remove: (owner: string) => void }
export const usePineRecoveryStore = create<State>(set => ({ progress: {}, update: value => set(state => ({ progress: { ...state.progress, [value.owner]: value } })), remove: owner => set(state => { const progress = { ...state.progress }; delete progress[owner]; return { progress }; }) }));
