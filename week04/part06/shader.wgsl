struct Uniforms {
  eye: vec3f,
  L_e: f32,
  L_a: f32,
  k_d: f32,
  k_s: f32,
  s: f32,
  mvp: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) clipPos: vec4f,
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

@vertex
fn main_vs(@location(0) inPos: vec3f) -> VSOut {
  var out: VSOut;

  // Transform into clip space
  out.clipPos = uniforms.mvp * vec4f(inPos, 1.0);

  // Unit sphere: position direction = normal direction
  out.pos = inPos;
  out.nrm = inPos;

  return out;
}

@fragment
fn main_fs(in: VSOut) -> @location(0) vec4f {
  // Interpolated normal must be renormalized
  let n = normalize(in.nrm);

  // Directional light: l_e=(0,0,-1) => incoming direction omega_i=(0,0,1)
  let omega_i = vec3f(0.0, 0.0, 1.0);

  // Material parameters (fixed colors scaled by sliders)
  let kd = vec3f(1.0, 0.0, 0.0) * uniforms.k_d;
  let ka = kd;
  let ks = vec3f(1.0) * uniforms.k_s;

  // Light / ambient radiance (white scaled by sliders)
  let Le = vec3f(1.0) * uniforms.L_e;
  let La = vec3f(1.0) * uniforms.L_a;

  // View direction from surface point to eye
  let wo = normalize(uniforms.eye - in.pos);

  // Reflection direction (Phong)
  let wr = normalize(2.0 * dot(omega_i, n) * n - omega_i);

  // Lambert diffuse term
  let ndotl = max(dot(n, omega_i), 0.0);
  let Ld = kd * Le * ndotl;

  // Ambient term
  let La_term = ka * La;

  // Specular term (disabled on the back side)
  let Ls = ks * Le * pow(max(dot(wr, wo), 0.0), uniforms.s);
  let Ls_sel = select(vec3f(0.0), Ls, ndotl > 0.0);

  // Final outgoing radiance
  let Lo = Ld + La_term + Ls_sel;
  return vec4f(Lo, 1.0);
}
