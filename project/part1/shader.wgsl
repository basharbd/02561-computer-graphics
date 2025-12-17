struct TeapotUniforms {
  mvp       : mat4x4f,
  model     : mat4x4f,
  normalMat : mat4x4f,
  eye       : vec4f,
  light     : vec4f, // .w = Le (Light Intensity)
  params    : vec4f, // x=La, y=kd, z=ks, w=shininess
};

@group(0) @binding(0) var<uniform> U : TeapotUniforms;

struct VSOut {
  @builtin(position) pos_clip : vec4f,
  @location(0) pos_world      : vec3f,
  @location(1) n_world        : vec3f,
};

@vertex
fn vs_teapot(
  @location(0) inPos : vec4f,
  @location(1) inNor : vec4f
) -> VSOut {
  var out : VSOut;
  
  // Transform to Clip Space
  out.pos_clip = U.mvp * inPos;

  // Transform to World Space
  let pw = U.model * inPos;
  out.pos_world = pw.xyz;

  // Transform Normal
  out.n_world = normalize((U.normalMat * inNor).xyz);

  return out;
}

@fragment
fn fs_teapot(in: VSOut) -> @location(0) vec4f {
  let baseColor = vec3f(0.92, 0.92, 0.92);

  let La = U.params.x;
  let kd = U.params.y;
  let ks = U.params.z;
  let s  = U.params.w;
  let Le = U.light.w;

  let N = normalize(in.n_world);
  let L = normalize(U.light.xyz - in.pos_world);
  let V = normalize(U.eye.xyz   - in.pos_world);
  let H = normalize(L + V);

  let diff = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, H), 0.0), s);

  let ambient = La * baseColor;
  let color = ambient + Le * (kd * diff * baseColor + ks * spec);

  return vec4f(color, 1.0);
}