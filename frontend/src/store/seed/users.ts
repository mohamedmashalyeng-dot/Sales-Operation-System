import type { User } from "@/store/types";

export const SEED_USERS: User[] = [
  {
    id: "u-amara",
    name: "Workspace Manager",
    role: "Manager",
    email: "manager@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-tom",
    name: "Sales User",
    role: "Sales",
    email: "sales@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-hannah",
    name: "Enrolment User",
    role: "Enrolment",
    email: "enrolment@kentbusinesscollege.local",
    team: "Workspace",
  },
  {
    id: "u-owen",
    name: "Workspace Admin",
    role: "Admin",
    email: "admin@kentbusinesscollege.local",
    team: "Workspace",
  },
];

export const CURRENT_USER_ID = "u-amara";
