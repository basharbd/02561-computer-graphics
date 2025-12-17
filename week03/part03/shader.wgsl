struct Uniforms {
  mvp : array<mat4x4f, 3>,
};

@group(0) @binding(0)
var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) col : vec4f,
};

@vertex
fn main_vs(
  @location(0) inPos   : vec4f,
  @location(1) inColor : vec4f,
  @builtin(instance_index) inst : u32
) -> VSOut {
  var o : VSOut;
  o.pos = u.mvp[inst] * inPos;
  o.col = inColor;
  return o;
}

@fragment
fn main_fs(@location(0) c : vec4f) -> @location(0) vec4f {
  return c;
}
