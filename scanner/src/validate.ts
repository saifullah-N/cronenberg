import { Spec, Validation } from "@cyclonedx/cyclonedx-library";

// Resolves null when `bomJson` is valid CycloneDX 1.7, otherwise the validation errors.
// Throws if the validator's optional dependencies (ajv, ajv-formats, ...) are missing.
export async function validateBom(bomJson: string): Promise<unknown> {
  return new Validation.JsonStrictValidator(Spec.Version.v1dot7).validate(bomJson);
}
