import { Avatar } from "@astryxdesign/core/Avatar";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Cable, KeyRound, LogOut } from "lucide-react";
import { signOut } from "../lib/api";
import { mcpEndpoint } from "../lib/config";
import { useStore } from "../lib/store";
import { Btn, Kv, KvList } from "../components/ui";

export default function Settings() {
  const { user, status, navigate } = useStore();
  const s = status || {};

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Heading level={2}>Settings</Heading>
        <Text type="supporting" className="mt-1">
          Profile, connection details, and server information.
        </Text>
      </div>

      <section className="panel">
        <Heading level={4}>Profile</Heading>
        <div className="mt-3 flex items-center gap-4">
          <Avatar src={user?.image || undefined} name={user?.name || "Account"} size="lg" />
          <div className="min-w-0 flex-1">
            <Text weight="semibold" className="truncate">{user?.name || "—"}</Text>
            <Text type="supporting" size="sm" className="mt-0.5 truncate">{user?.email || "—"}</Text>
          </div>
        </div>
      </section>

      <section className="panel">
        <Heading level={4}>Connection</Heading>
        <div className="mt-2">
          <KvList>
            <Kv k="Endpoint URL" v={mcpEndpoint()} mono />
            <Kv k="Auth" v="Authorization: Bearer <your-api-token>" />
          </KvList>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="plate" icon={<KeyRound size={13} />} onClick={() => navigate("tokens")}>Create token</Btn>
          <Btn variant="plate" icon={<Cable size={13} />} onClick={() => navigate("connect")}>Connect guide</Btn>
        </div>
      </section>

      <section className="panel">
        <Heading level={4}>About</Heading>
        <div className="mt-2">
          <KvList>
            <Kv k="Protocol" v={s.protocol || "—"} mono />
            <Kv k="Version" v={s.version || "—"} mono />
            <Kv k="Node" v={s.node || "—"} mono />
          </KvList>
        </div>
      </section>

      <section className="panel panel-danger">
        <Heading level={4}>Account</Heading>
        <Text type="supporting" size="sm" className="mt-1">
          Sign out ends this session. API tokens keep working until revoked.
        </Text>
        <Btn variant="danger" className="mt-3 self-start" icon={<LogOut size={13} />} onClick={() => signOut()}>Sign out</Btn>
      </section>
    </div>
  );
}
