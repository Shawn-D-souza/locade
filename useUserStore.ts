import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuid } from "uuid";
import { uniqueNamesGenerator, adjectives, animals } from "unique-names-generator";

interface User {
    userId: string;
    userName: string;
    setUserName: (name: string) => void;
}

const generateRandomName = () => {
    return uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        separator: " ",
        style: 'capital',
        length: 2
    })
}

const getOrInitializeUser = (): { userId: string; userName: string } => {
    const STORAGE_KEY = 'locade-user-storage';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.state?.userId && parsed.state?.userName) {
                return {
                    userId: parsed.state.userId,
                    userName: parsed.state.userName
                };
            }
        }
    } catch (e) {
        console.warn("Failed to load user state:", e);
    }

    const newUser = {
        userId: uuid(),
        userName: generateRandomName()
    };

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: newUser, version: 0 }));
    } catch (e) {
        console.warn("Failed to save initial user state:", e);
    }

    return newUser;
}

const initialPlayer = getOrInitializeUser();

export const useUser = create<User>()(
    persist(
        (set) => ({
            userId: initialPlayer.userId,
            userName: initialPlayer.userName,
            setUserName: (newName) => set({ userName: newName })
        }),
        {
            name: 'locade-user-storage'
        }
    )
)