import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Cable, KeyRound, LogOut } from "lucide-react";
import { signOut } from "../lib/api";
import { mcpEndpoint } from "../lib/config";
import { useStore } from "../lib/store";
import { Kv, KvList } from "../components/ui";

export default function Settings() {
  const { user, status, navigate } = useStore();
  const s = status || {};


  return (
    <div className="flex flex-col gap-4">
      <div>
        <Heading level={2}>Settings</Heading>
        <Text type="supporting" className="mt-1">
          Your profile, connection details, and server information.
        </Text>
      </div>

      <Card padding={5}>
        <Heading level={4}>Profile</Heading>
        <div className="mt-3 flex items-center gap-4">
          <Avatar src={user?.image || undefined} name={user?.name || "Account"} size="lg" />
          <div className="min-w-0 flex-1">
            <Text weight="semibold" className="truncate">
              {user?.name || "—"}
            </Text>
            <Text type="supporting" size="sm" className="mt-0.5 truncate">
              {user?.email || "—"}
            </Text>
          </div>
        </div>
      </Card>

      <Card padding={5}>
        <Heading level={4}>Connection</Heading>
        <div className="mt-2">
          <KvList>
            <Kv k="Endpoint URL" v={mcpEndpoint()} mono />
            <Kv k="Auth" v="Authorization: Bearer <your-api-token>" />
          </KvList>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            label="Create an API token"
            variant="secondary"
            icon={<KeyRound size={14} />}
            onClick={() => navigate("tokens")}
          />
          <Button
            label="Open connect guide"
            variant="secondary"
            icon={<Cable size={14} />}
            onClick={() => navigate("connect")}
          />
        </div>
      </Card>

      <Card padding={5}>
        <Heading level={4}>About</Heading>
        <div className="mt-2">
          <KvList>
            <Kv k="Protocol" v={s.protocol || "—"} mono />
            <Kv k="Server version" v={s.version || "—"} mono />
            <Kv k="Node" v={s.node || "—"} mono />
          </KvList>
        </div>
      </Card>

      <Card padding={5} variant="red">
        <Heading level={4}>Account</Heading>
        <Text type="supporting" size="sm" className="mt-1">
          Signing out ends your session in this browser. API tokens keep working until revoked.
        </Text>
        <Button
          label="Sign out"
          variant="destructive"
          className="mt-3"
          icon={<LogOut size={15} />}
          onClick={() => signOut()}
        />
      </Card>
    </div>
  );
}
