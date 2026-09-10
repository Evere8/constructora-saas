"""Narrow recovery helpers for the non-transactional MySQL migrations 0009/0010.

Only missing DDL is executed. Existing rows are never removed and unexpected
table definitions fail explicitly instead of being silently stamped as migrated.
"""

import sqlalchemy as sa

from alembic.operations import Operations


class ResumableDDL:
    def __init__(self, operations: Operations) -> None:
        self.op = operations
        self.connection = operations.get_bind()

    def inspector(self):
        # MySQL commits each DDL statement; do not cache pre-DDL reflection.
        return sa.inspect(self.connection)

    def ensure_version_capacity(self) -> None:
        columns = self.inspector().get_columns("alembic_version")
        column = next(item for item in columns if item["name"] == "version_num")
        capacity = getattr(column["type"], "length", None)
        if capacity is not None and capacity < 128:
            self.op.alter_column(
                "alembic_version",
                "version_num",
                existing_type=column["type"],
                type_=sa.String(128),
                existing_nullable=False,
            )

    def create_table(self, name, *elements, **kwargs):
        if not self.inspector().has_table(name):
            return self.op.create_table(name, *elements, **kwargs)
        existing = {column["name"] for column in self.inspector().get_columns(name)}
        required = {element.name for element in elements if isinstance(element, sa.Column)}
        if missing := required - existing:
            raise RuntimeError(f"La tabla {name} tiene una estructura inesperada: faltan {missing}")
        return None

    def create_index(self, name, table, columns, **kwargs):
        for index in self.inspector().get_indexes(table):
            if index["name"] == name:
                if list(index["column_names"]) != list(columns):
                    raise RuntimeError(f"El índice {name} tiene columnas inesperadas")
                return
        self.op.create_index(name, table, columns, **kwargs)

    def add_column(self, table, column):
        if column.name not in {item["name"] for item in self.inspector().get_columns(table)}:
            self.op.add_column(table, column)

    def create_foreign_key(self, name, source, target, columns, target_columns, **kwargs):
        for fk in self.inspector().get_foreign_keys(source):
            same = (
                fk["constrained_columns"] == list(columns)
                and fk["referred_table"] == target
                and fk["referred_columns"] == list(target_columns)
                and fk.get("options", {}).get("ondelete", "RESTRICT")
                == kwargs.get("ondelete", "RESTRICT")
            )
            if fk["name"] == name and not same:
                raise RuntimeError(f"La relación {name} tiene una definición inesperada")
            if same:
                return
        self.op.create_foreign_key(name, source, target, columns, target_columns, **kwargs)

    def create_unique_constraint(self, name, table, columns):
        for constraint in self.inspector().get_unique_constraints(table):
            if constraint["name"] == name:
                if constraint["column_names"] != list(columns):
                    raise RuntimeError(f"La restricción {name} tiene columnas inesperadas")
                return
        self.op.create_unique_constraint(name, table, columns)

    def drop_unique_if_present(self, name, table):
        if name in {item["name"] for item in self.inspector().get_unique_constraints(table)}:
            self.op.drop_constraint(name, table, type_="unique")
