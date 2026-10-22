#!/usr/bin/env bash
set -Eeuo pipefail

: "${RELEASE:?Set RELEASE to the current Overture STAC release}"
: "${THEME:?Set THEME to an official Overture theme}"
: "${BBOX:?Set BBOX to minLon,minLat,maxLon,maxLat}"

case "$THEME" in
  base) profile=Base ;;
  buildings) profile=Buildings ;;
  places) profile=Places ;;
  transportation) profile=Transportation ;;
  *) echo "Unsupported theme: $THEME" >&2; exit 2 ;;
esac

# Reuse Overture's own regional Parquet filter and Planetiler profile from its
# published image. Keep the filtered input so the workflow can record its count.
bash /bbox.sh "$RELEASE" "$BBOX" "$THEME" /data s3://overturemaps-us-west-2/release us-west-2

shopt -s nullglob
inputs=(/data/theme="$THEME"/type=*/filtered.parquet)
if ((${#inputs[@]} == 0)); then
  echo "No source Parquet partitions were returned for $THEME in $BBOX" >&2
  exit 3
fi

for file in "${inputs[@]}"; do
  type=${file#*/type=}
  type=${type%%/*}
  rows=$(duckdb -noheader -csv -c "SELECT count(*) FROM read_parquet('$file')" | tail -n 1 | tr -d '\r')
  [[ "$rows" =~ ^[0-9]+$ ]] || { echo "Could not count $THEME/$type source rows" >&2; exit 4; }
  named=0
  if [[ "$THEME/$type" == "places/place" ]]; then
    # Overture's place schema exposes primary labels at names.primary.
    named=$(duckdb -noheader -csv -c "SELECT count(*) FILTER (WHERE names.primary IS NOT NULL AND length(names.primary) > 0) FROM read_parquet('$file')" | tail -n 1 | tr -d '\r')
    [[ "$named" =~ ^[0-9]+$ ]] || { echo "Could not count primary place names" >&2; exit 4; }
  fi
  printf '%s\t%s\t%s\n' "$type" "$rows" "$named" >> "/counts/$THEME.tsv"
done

cd /
java -XX:MaxRAMPercentage=70 \
  -Dtiles.version="$RELEASE" \
  -cp /planetiler.jar "/profiles/${profile}.java" \
  --data=/data

archive="/data/${THEME}.pmtiles"
test -s "$archive" || { echo "Planetiler did not produce $archive" >&2; exit 5; }
# The host-mounted data directory is also the Pages staging directory. Keep
# only the generated archive there; source Parquet inputs remain inside the
# disposable runner's mounted workspace only until this theme is complete.
rm -rf -- "/data/theme=$THEME"
printf '%s\n' "Built $archive"
