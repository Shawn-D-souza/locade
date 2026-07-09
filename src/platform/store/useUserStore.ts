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
    const name = uniqueNamesGenerator({
        dictionaries: [adjectives, animals],
        separator: " ",
        style: 'capital',
        length: 2
    });
    return name.length > 15 ? name.substring(0, 15).trim() : name;
}

export const useUser = create<User>()(
    persist(
        (set) => ({
            userId: uuid(),
            userName: generateRandomName(),
            setUserName: (newName) => set({ userName: newName })
        }),
        {
            name: 'locade-user-storage'
        }
    )
);

// Zustand's persist middleware does not automatically save the initial default state.
// We manually save it on the first load so the generated name and ID don't change on refresh.
if (!localStorage.getItem('locade-user-storage')) {
    const state = useUser.getState();
    localStorage.setItem('locade-user-storage', JSON.stringify({
        state: {
            userId: state.userId,
            userName: state.userName
        },
        version: 0
    }));
}