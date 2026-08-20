import { useCallback } from "react";
import { errMsg, putPrefs } from "./api";
import { useStore } from "./store";

/** Toggle one module's disabled state in the user's prefs, with optimistic UI. */
export function useModuleToggle() {
  const { me, setMe, toast } = useStore();
  return useCallback(
    async (name: string, checked: boolean) => {
      const next = new Set(me?.disabledModules || []);
      if (checked) next.delete(name);
      else next.add(name);
      try {
        await putPrefs({ disabledModules: [...next] });
        setMe(me ? { ...me, disabledModules: [...next] } : me);
      } catch (err) {
        toast(errMsg(err, "Update failed"));
      }
    },
    [me, setMe, toast],
  );
}
