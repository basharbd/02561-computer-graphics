struct Uniforms {
  eye: vec3f,
  L_e: f32,
  L_a: f32,
  k_d: f32,
  k_s: f32,
  s: f32,
  mvp: mat4x4f,
};

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) clipPos: vec4f,
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
};

@vertex
fn main_vs(@location(0) inPos: vec3f) -> VSOut {
  var out: VSOut;
  out.clipPos = uniforms.mvp * vec4f(inPos, 1.0);

  // unit sphere: normal is same direction as position
  out.pos = inPos;
  out.nrm = inPos;
  return out;
}

@fragment
fn main_fs(in: VSOut) -> @location(0) vec4f {
  // re-normalize because it is interpolated
  let n = normalize(in.nrm);

  // directional light: l_e = (0,0,-1) => omega_i = (0,0,1)
  let omega_i = vec3f(0.0, 0.0, 1.0);

  // material
  let kd = vec3f(1.0, 0.0, 0.0) * uniforms.k_d;
  let ka = kd;
  let ks = vec3f(1.0) * uniforms.k_s;

  // radiance
  let Le = vec3f(1.0) * uniforms.L_e;
  let La = vec3f(1.0) * uniforms.L_a;

  // view direction
  let wo = normalize(uniforms.eye - in.pos);

  // reflection direction (re-normalize for safety)
  let wr = normalize(2.0 * dot(omega_i, n) * n - omega_i);

  let ndotl = max(dot(n, omega_i), 0.0);

  let Ld = kd * Le * ndotl;
  let La_term = ka * La;

  let Ls = ks * Le * pow(max(dot(wr, wo), 0.0), uniforms.s);
  let Ls_sel = select(vec3f(0.0), Ls, ndotl > 0.0);

  let Lo = Ld + La_term + Ls_sel;
  return vec4f(Lo, 1.0);
}
