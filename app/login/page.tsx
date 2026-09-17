import { LoginForm } from "@/components/layout/login-form";

export const metadata = {
  title: "Entrar — Nexo",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const { email } = await props.searchParams;
  const prefillEmail = typeof email === "string" ? email : "";

  return <LoginForm prefillEmail={prefillEmail} />;
}
