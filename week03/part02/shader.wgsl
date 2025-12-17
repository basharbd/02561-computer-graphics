struct Uniforms {
  mvp : array<mat4x4f, 3>,
};

@group(0) @binding(0)
var<uniform> U : Uniforms;

struct VSOut {
  @builtin(position) position : vec4f,
  @location(0) color : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos : vec3f,
  @location(1) inColor : vec4f,
  @builtin(instance_index) instance : u32
) -> VSOut {
  var out : VSOut;
  out.position = U.mvp[instance] * vec4f(inPos, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  return c;
}
