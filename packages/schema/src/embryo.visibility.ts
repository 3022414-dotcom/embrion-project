import type {
  Embryo,
  EmbryoForPatient,
  EmbryoForCoordinator,
  EmbryoForAdmin,
  Role,
} from "./embryo.types.js";

function projectForPatient(embryo: Embryo): EmbryoForPatient {
  return {
    status: embryo.status,
    egg_donor: embryo.egg_donor,
    sperm_donor: embryo.sperm_donor,
    ...(embryo.phenotype !== undefined ? { phenotype: embryo.phenotype } : {}),
    genetics: {
      screening_status: embryo.genetics.screening_status,
    },
    medical: embryo.medical,
    ...(embryo.matching !== undefined
      ? {
          matching: {
            ...(embryo.matching.compatible_blood_types !== undefined
              ? { compatible_blood_types: embryo.matching.compatible_blood_types }
              : {}),
          },
        }
      : {}),
    media: embryo.media,
  };
}

function projectForCoordinator(embryo: Embryo): EmbryoForCoordinator {
  const { deleted_at: _deleted, ...metaWithoutDeleted } = embryo.meta;
  return {
    ...embryo,
    meta: metaWithoutDeleted,
  };
}

function projectForAdmin(embryo: Embryo): EmbryoForAdmin {
  return embryo;
}

export function projectEmbryo(role: Role, embryo: Embryo): EmbryoForPatient | EmbryoForCoordinator | EmbryoForAdmin {
  switch (role) {
    case "patient":
      return projectForPatient(embryo);
    case "coordinator":
      return projectForCoordinator(embryo);
    case "admin":
      return projectForAdmin(embryo);
  }
}
