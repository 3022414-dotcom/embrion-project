import { projectEmbryo } from "@embrion/schema";
import type { Embryo, Role, EmbryoForPatient, EmbryoForCoordinator, EmbryoForAdmin } from "@embrion/schema";

export function projectForCaller(
  role: Role,
  embryo: Embryo,
): EmbryoForPatient | EmbryoForCoordinator | EmbryoForAdmin {
  return projectEmbryo(role, embryo);
}
