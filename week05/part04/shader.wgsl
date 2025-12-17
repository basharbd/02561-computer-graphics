struct Uniforms {
  lightPosView : vec4f,   // xyz + pad
  params1      : vec4f,   // Le, La, kd, ks
  params2      : vec4f,   // s, 0, 0, 0
  mvp          : mat4x4f,
  mv           : mat4x4f,
  normalMat    : mat4x4f, // inverse-transpose(MV)
};

@group(0) @binding(0)
var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) posView        : vec3f,
  @location(1) normalView     : vec3f,
  @location(2) color          : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos    : vec4f,
  @location(1) inColor  : vec4f,
  @location(2) inNormal : vec4f
) -> VSOut {
  var out : VSOut;

  let posV4 = u.mv * inPos;
  out.position = u.mvp * inPos;

  // pass view-space position
  out.posView = posV4.xyz;

  // transform normals to view-space (w=0)
  let nV4 = u.normalMat * vec4f(inNormal.xyz, 0.0);
  out.normalView = nV4.xyz;

  out.color = inColor;
  return out;
}

@fragment
fn main_fs(in : VSOut) -> @location(0) vec4f {
  let Le = u.params1.x;
  let La = u.params1.y;
  let kd_coeff = u.params1.z;
  let ks_coeff = u.params1.w;
  let shin = u.params2.x;

  // ✅ normalize interpolated normal
  let n = normalize(in.normalView);

  // ✅ point light in VIEW space
  let lightVec = u.lightPosView.xyz - in.posView;
  let dist = max(length(lightVec), 1e-4);
  let l = lightVec / dist;

  // optional inverse-square falloff (feels more "point light")
  let attenuation = 1.0 / (dist * dist);

  // view vector (eye at origin in view space)
  let v = normalize(-in.posView);

  // material colors
  let k_d = in.color.xyz * kd_coeff;
  let k_a = k_d;
  let k_s = vec3f(1.0, 1.0, 1.0) * ks_coeff;

  let L_e = vec3f(1.0) * Le;
  let L_a = vec3f(1.0) * La;

  // diffuse
  let ndotl = max(dot(n, l), 0.0);
  let L_rd = k_d * L_e * ndotl * attenuation;

  // ambient
  let L_ra = k_a * L_a;

  // specular (Phong)
  var L_rs = vec3f(0.0);
  if (ndotl > 0.0) {
    let r = reflect(-l, n); // reflect incoming (-l) around n
    let spec = pow(max(dot(r, v), 0.0), shin);
    L_rs = k_s * L_e * spec * attenuation;
  }

  let L_o = L_rd + L_ra + L_rs;
  return vec4f(L_o, 1.0);
}
